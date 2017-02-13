'use strict'

const PNG = require('pngjs').PNG,
    fs = require('fs'),
    Hexasphere = require('hexasphere.js');

function latLonToXY(width, height, lat, lon) {

    const x = Math.floor(width/2.0 + (width/360.0)*lon);
    const y = Math.floor((height/2.0 + (height/180.0)*lat));

    return {x: x, y: y};
}

function xyToIdx(x, y, width) {
    return (width * y + x) << 2;
}

function rnd(num) {
    return Math.round(num * 100) / 100;
}

// use a smaller representation of the tiles
function compress(t) {
    return t;
}

// original coverage implementation, samples points at the location of the hex grid
function computeCoverForTiles_sample(png, tiles, radius) {
    let count = 0;
    for (let j = 0; j< tiles.boundary.length; j++) {
        let latLon = tiles.getLatLon(radius, j);
        let xy = latLonToXY(png.width, png.height, latLon.lat, latLon.lon);
        let idx = xyToIdx(xy.x, xy.y, png.width);
        count += 255 - png.data[idx];
    }

    let latLon = tiles.getLatLon(radius); // sample center point
    let xy = latLonToXY(png.width, png.height, latLon.lat, latLon.lon);
    let idx = xyToIdx(xy.x, xy.y, png.width);
    count += 255 - png.data[idx];
    
    return (count / (tiles.boundary.length + 1)) / 255;
}

// new implementation, count the pixels in the bounding box
function computeCoverForTiles_box(png, tiles, radius) {
    let minx = png.width + 1,
        miny = png.height + 1,
        maxx = 0,
        maxy = 0;
        
    for (let j = 0; j < tiles.boundary.length; j++) {
        let latLon = tiles.getLatLon(radius, j);
        let xy = latLonToXY(png.width, png.height, latLon.lat, latLon.lon);

        if (xy.x < minx) minx = xy.x;
        if (xy.y < miny) miny = xy.y;
        
        if (xy.x > maxx) maxx = xy.x;
        if (xy.y > maxy) maxy = xy.y;
    }

    if (maxx > png.width) maxx = png.width;
    if (maxy > png.height) maxy = png.height;    

    const w = (maxx - minx);
    const h = (maxy - miny);
    
    const dst = new PNG({width: w, height: h});
    png.bitblt(dst, minx, miny, w, h, 0, 0);

    let count = 0;
    for (let i = 0; i < dst.data.length; i++) {
        count += 255 - dst.data[i];
    }
    if (minx < 5) {
        console.log(minx, miny, count, dst.data.length);   

        dst.pack().pipe(fs.createWriteStream(`${minx}_${miny}.png`));
    }

    return count / (dst.data.length * 255);
}

function createGrid(map, p) {
    p = p || {};
    let radius = p.radius || 500;
    let divisions = p.divisions || 35;
    let width = p.width || .45; 
    let tiny = p.tiny != null ? p.tiny : false;
    let threshold = p.threshold || 0.1;
    let box = p.box != null ? p.box : true;
    let dfile = '_debug.png'; // TEMP


    const hexasphere = new Hexasphere(radius, divisions, width);

    const o = { src: map, tiles: [] };

    return new Promise((ok) => {
        if (map == null) {
            throw new Error('No map supplied');
        }

        fs.createReadStream(map)
        .pipe(new PNG({
            filterType: 4
        }))
        .on('parsed', function() {
            const debugBuffer = Buffer.alloc(this.data.length, 255);

            for (let i = 0; i< hexasphere.tiles.length; i++) {
                let latLon = hexasphere.tiles[i].getLatLon(radius);
                let size = box ? computeCoverForTiles_box(this, hexasphere.tiles[i], radius) : computeCoverForTiles_sample(this, hexasphere.tiles[i], radius);

                // threshold < 0 is basically a ignore value
                if (size > threshold || threshold < 0) {
                    let tile = {lat: rnd(latLon.lat), lon: rnd(latLon.lon), b: [] };
                    let scale = size - Math.random() * .25;

                    for (let j = 0; j< hexasphere.tiles[i].boundary.length; j++) {
                        let newPoint = hexasphere.tiles[i].boundary[j].segment(hexasphere.tiles[i].centerPoint, size);
                        tile.b.push({
                            x: rnd(newPoint.x),
                            y: rnd(newPoint.y),
                            z: rnd(newPoint.z)
                        });
                    }

                    o.tiles.push(tiny ? compress(tile) : tile);
                }
            }
            let json = null;
            if (tiny) {
                json = JSON.stringify(o);
            } else {
                json = JSON.stringify(o, null, 4);
            }
            
            if (dfile) {
                const debug = new PNG({ width: this.width, height: this.height, colorType: 2 });
                debug.data = debugBuffer;
                debug.pack()
                    .pipe(fs.createWriteStream(dfile))
                    .on('finish', function() {
                        console.log(`debug PNG file ${dfile} written`);
                    });
            }

            ok(json);
        });
    });

}

module.exports = createGrid;


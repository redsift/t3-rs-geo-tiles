'use strict'

const PNG = require('pngjs').PNG,
    fs = require('fs'),
    Hexasphere = require('hexasphere.js'),
    url = require('url'),
    crypto = require('crypto'),
    os = require('os'),
    path = require('path'),
    d3Geo = require('d3-geo'),
    d3GeoProjection = require('d3-geo-projection');

function latLonToXY(width, height, pj) {
    pj = pj || 'geoEquirectangular';

    let pjFn = d3GeoProjection[pj];
    if (pjFn == null) {
        pjFn = d3Geo[pj];
    }
    if (pjFn == null) {
        throw new Error(`Unknown projection "${pj}", please check https://github.com/d3/d3-geo-projection for supported list`);
    }
    const projection = pjFn().fitSize([ width, height ], { type: "Sphere" });

    return function _latLonToXY(lat, lon) {
        const d = projection([lon, -lat]);

        /*
        //NOTE: Previous impl
        const x = Math.floor(width/2.0 + (width/360.0)*lon);
        const y = Math.floor((height/2.0 + (height/180.0)*lat));

        let dt = Math.abs(x - Math.floor(d[0])) + Math.abs(y - Math.floor(d[1]));
        if (dt > 1) {
            console.log(d, x, y);
        }
        */

        // TODO: Floor vs round?
        return { x: Math.floor(d[0]), y: Math.floor(d[1]) };
    }
}

function xyToIdx(x, y, width) {
    return (width * y + x) << 2;
}

function rnd(num) {
    return Math.round(num * 100) / 100;
}

// use a smaller representation of the tiles
// object to array [ v, a, lat, log, b... ]
function compress(t) {
    return t.b.reduce((p, c) => p.concat([ c.x, c.y, c.z ]), 
                        [ t.v ? t.v : 0.0, t.a ? 1.0 : 0.0, t.lat, t.lon ]);
}

// original coverage implementation, samples points at the location of the hex grid
function computeCoverForTiles_sample(png, tiles, radius, lLToXY) {
    let count = 0;
    for (let j = 0; j< tiles.boundary.length; j++) {
        let latLon = tiles.getLatLon(radius, j);
        let xy = lLToXY(latLon.lat, latLon.lon);
        let idx = xyToIdx(xy.x, xy.y, png.width);
        count += 255 - png.data[idx];
    }

    let latLon = tiles.getLatLon(radius); // sample center point
    let xy = lLToXY(latLon.lat, latLon.lon);
    let idx = xyToIdx(xy.x, xy.y, png.width);
    count += 255 - png.data[idx];
    
    return (count / (tiles.boundary.length + 1)) / 255;
}

// new implementation, count the pixels in the bounding box
function computeCoverForTiles_box(png, tiles, radius, lLToXY) {
    let minx = png.width + 1,
        miny = png.height + 1,
        maxx = 0,
        maxy = 0;
        
    for (let j = 0; j < tiles.boundary.length; j++) {
        let latLon = tiles.getLatLon(radius, j);
        let xy = lLToXY(latLon.lat, latLon.lon);

        if (xy.x < minx) minx = xy.x;
        if (xy.y < miny) miny = xy.y;
        
        if (xy.x > maxx) maxx = xy.x;
        if (xy.y > maxy) maxy = xy.y;
    }

    if ((maxx - minx) > png.width / 2) {
        // wrap around
        // hack, just take the positive block. causes mild distortion for earth
        // could be done properly
        maxx = 0;

        for (let j = 0; j < tiles.boundary.length; j++) {
            let latLon = tiles.getLatLon(radius, j);
            let xy = lLToXY(latLon.lat, latLon.lon);

            if (xy.x > png.width / 2) {
                continue;
            }

            if (xy.x > maxx) maxx = xy.x;
        }
    } 

    const w = (maxx - minx);
    const h = (maxy - miny);

    if (w === 0 || h === 0) return 0.0;

    const dst = new PNG({width: w, height: h});
    png.bitblt(dst, minx, miny, w, h, 0, 0);

    let count = 0;
    for (let i = 0; i < dst.data.length; i++) {
        if ((i+1) % 4 === 0) {
            // skip alpha channel
            continue;
        }
        count += 255 - dst.data[i];
    }
    
    const score = count / ((dst.data.length / (4/3))  * 255);

    return score;
}

function mapColor(c, scale) {

    for (let e of scale) {
        if (e.color[0] === c[0] && e.color[1] === c[1] && e.color[2] === c[2]) {
            return e.value;
        }
    }

    console.log('Unknown color', c); // eslint-disable-line no-console
    return 0;
}

function gammaClamp(v, g) {
    const vg = Math.pow(v, 1/g);

    return Math.min(vg * 255.0, 255.0);
}

function createValueFunction(value) {
    if (value == null) return Promise.resolve(null);

   
    return new Promise((ok, ko) => {
        const hash = crypto.createHash('sha256').update(value.url).digest('hex');
        const tmpfile = path.join(os.tmpdir(), hash);
        let cached = false;
        try {
            cached = (fs.accessSync(tmpfile, fs.F_OK | fs.R_OK) == null);
        }
        catch(e) {
            // ignore
        }
        const stream = function(response) {
            response.pipe(new PNG({
                    filterType: 4
            }))
            .on('parsed', function() {
                if (!cached) {
                    fs.writeFileSync(tmpfile, PNG.sync.write(this));
                }

                this.adjustGamma();

                const g = value.gamma || 1.0;
                const w = value.offset.width ? value.offset.width : value.crop.x2 - value.crop.x1;
                const h = value.offset.height ? value.offset.height : value.crop.y2 - value.crop.y1;

                const remapped = new PNG({ width: w, height: h, colorType: 2 });
                this.bitblt(remapped, value.crop.x1, value.crop.y1, value.crop.x2 - value.crop.x1, value.crop.y2 - value.crop.y1, value.offset.x ? value.offset.x : 0, value.offset.y ? value.offset.y : 0);

                for (let i = 0; i < remapped.data.length; i += 4) {
                    const v = gammaClamp(mapColor([ remapped.data[i], remapped.data[i+1], remapped.data[i+2] ], value.scale), g);
                    remapped.data[i] = v;
                    remapped.data[i+1] = v;
                    remapped.data[i+2] = v;
                    remapped.data[i+3] = 255;
                }

                // write a debug file if required
                const dfile = value.debug; 
                if (dfile) {
                    remapped.pack()
                        .pipe(fs.createWriteStream(dfile))
                        .on('finish', function() {
                            console.log(`debug PNG file ${dfile} written`); // eslint-disable-line no-console
                        });
                }

                const lLToXY = latLonToXY(remapped.width, remapped.height, value.projection);
                const fn = (tiles, radius) => {
                    return computeCoverForTiles_box(remapped, tiles, radius, lLToXY);
                };

                /* Super debug */

                ok(fn);        
            })
            .on('error', e => ko(`Could not parse PNG ${value.url}. ${e}`));
        }

        if (cached) {
            stream(fs.createReadStream(tmpfile));
        } else {
            const protocol = url.parse(value.url).protocol === 'https:' ? require('https') : require('http');
            protocol.get(value.url, stream);
        }
    });
}

function createGrid(map, p) {

    p = p || {};
    let radius = p.radius || 500;
    let divisions = p.divisions || 35;
    let width = p.width || .45; 
    let tiny = p.tiny != null ? p.tiny : false;
    let threshold = p.threshold || 0.1; //TODO: Expose these options
    let box = p.box != null ? p.box : true; //TODO: Expose these options
    let ocean = p.ocean || 0.0; 
    let value = createValueFunction(p.value);

    const hexasphere = new Hexasphere(radius, divisions, width);
    let oceansphere = null;
    if (ocean > 0.0) {
        oceansphere = new Hexasphere(radius, divisions, ocean);
    }
    const o = { src: map, tiny: tiny, tiles: [] };

    return value.then((valueFn) => {
        return new Promise((ok) => {
            if (map == null) {
                throw new Error('No map supplied');
            }

            fs.createReadStream(map)
            .pipe(new PNG({
                filterType: 4
            }))
            .on('parsed', function() {
                const lLToXY = latLonToXY(this.width, this.height);

                for (let i = 0; i< hexasphere.tiles.length; i++) {
                    let latLon = hexasphere.tiles[i].getLatLon(radius);
                    let size = box ? computeCoverForTiles_box(this, hexasphere.tiles[i], radius, lLToXY) : computeCoverForTiles_sample(this, hexasphere.tiles[i], radius, lLToXY);

                    // threshold < 0 is basically a ignore value
                    if (size > threshold || threshold < 0 || (size === 0.0 && oceansphere)) {
                        let tile = {lat: rnd(latLon.lat), lon: rnd(latLon.lon), b: [] };
                        if (size === 0.0 && oceansphere) {
                            // Mark these out
                            tile.a = 1;
                            size = 1.0;

                            for (let j = 0; j< oceansphere.tiles[i].boundary.length; j++) {
                                let newPoint = oceansphere.tiles[i].boundary[j].segment(oceansphere.tiles[i].centerPoint, size);
                                tile.b.push({
                                    x: rnd(newPoint.x),
                                    y: rnd(newPoint.y),
                                    z: rnd(newPoint.z)
                                });
                            }
                        } else if (valueFn != null) {
                            tile.v = rnd(valueFn(hexasphere.tiles[i], radius));

                            for (let j = 0; j< hexasphere.tiles[i].boundary.length; j++) {
                                let newPoint = hexasphere.tiles[i].boundary[j].segment(hexasphere.tiles[i].centerPoint, size);
                                tile.b.push({
                                    x: rnd(newPoint.x),
                                    y: rnd(newPoint.y),
                                    z: rnd(newPoint.z)
                                });
                            }
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


                ok(json);
            });
        });
    });
}

module.exports = createGrid;


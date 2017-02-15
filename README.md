# d3-rs-globe-tiles

[![Circle CI](https://img.shields.io/circleci/project/redsift/d3-rs-globe-tiles.svg?style=flat-square)](https://circleci.com/gh/redsift/d3-rs-globe-tiles)
[![npm](https://img.shields.io/npm/v/@redsift/d3-rs-globe-tiles.svg?style=flat-square)](https://www.npmjs.com/package/@redsift/d3-rs-globe-tiles)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://raw.githubusercontent.com/redsift/d3-rs-globe-tiles/master/LICENSE)

`d3-rs-globe-tiles` is a command line tool to create hex tiles from a PNG map.

## Usage

```bash
$ npm install d3-rs-globe-tiles -g
$ buildgrid -o tiles/grid.js resources/equirectangle_projection.png
```

## Mapping Data

Data values can be mapped into the hex bins. Data is defined by assembling a descriptor JSON file that maps the method of extracting the data from a PNG.

The most complex operation is normalization of the projection. The canonocal PNG layout for the projections can be viewed in the d3 repository. https://github.com/d3/d3-geo-projection/tree/master/img

## Attribution

This software is substantially based on encom-globe by Robert Scanlon, licensed under MIT.
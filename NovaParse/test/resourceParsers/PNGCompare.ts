global.Promise = require("bluebird"); // For stacktraces
import * as fs from "fs";
import { PNG } from "pngjs";
import { assert } from "chai";


function getPNG(path: string): Promise<PNG> {
    return new Promise(function(fulfill, reject) {
        var pngObj = new PNG({ filterType: 4 });
        fs.createReadStream(path)
            .pipe(pngObj)
            .on('parsed', function() {
                fulfill(pngObj);
            })
            .on('error', reject);
    });
};

function getFrames(png: PNG, dim: { width: number, height: number }) {

    // dim is dim of each frame;
    assert.equal(png.height % dim.height, 0);
    assert.equal(png.width % dim.width, 0);

    var out = [];

    for (var y = 0; y < png.height; y += dim.height) {
        for (var x = 0; x < png.width; x += dim.width) {
            var outPNG = new PNG({ filterType: 4, width: dim.width, height: dim.height });

            for (var xi = 0; xi < dim.width; xi++) {
                for (var yi = 0; yi < dim.height; yi++) {
                    var outidx = (outPNG.width * yi + xi) << 2;
                    var sourceidx = (png.width * (y + yi) + x + xi) << 2;
                    outPNG.data[outidx] = png.data[sourceidx];
                    outPNG.data[outidx + 1] = png.data[sourceidx + 1];
                    outPNG.data[outidx + 2] = png.data[sourceidx + 2];
                    outPNG.data[outidx + 3] = png.data[sourceidx + 3];
                }
            }

            out.push(outPNG);
        }
    }
    return out;

};

function comparePNGs(png1: PNG, png2: PNG) {
    assert(png1 instanceof PNG);
    assert(png2 instanceof PNG);
    assert.equal(png1.width, png2.width);
    assert.equal(png1.height, png2.height);
    assert.equal(png1.gamma, png2.gamma);
    //	assert(png1.data.equals(png2.data));

    // fuzzy compare
    for (var y = 0; y < png1.height; y++) {
        for (var x = 0; x < png1.width; x++) {
            var idx = (png1.width * y + x) << 2;

            if ((png1.data[idx + 3] !== 0) || (png2.data[idx + 3]) !== 0) {
                assert.equal(png1.data[idx] >> 3, png2.data[idx] >> 3);
                assert.equal(png1.data[idx + 1] >> 3, png2.data[idx + 1] >> 3);
                assert.equal(png1.data[idx + 2] >> 3, png2.data[idx + 2] >> 3);
                assert.equal(png1.data[idx + 3], png2.data[idx + 3]);

            }

        }
    }
};

function applyMask(image: PNG, mask: PNG) {
    assert.equal(image.width, mask.width);
    assert.equal(image.height, mask.height);

    var out = new PNG({
        filterType: 4,
        width: image.width,
        height: image.height
    });
    image.data.copy(out.data, 0, 0, image.data.length); // copy image to out

    for (var y = 0; y < image.height; y++) {
        for (var x = 0; x < image.width; x++) {
            var idx = (image.width * y + x) << 2;

            if ((mask.data[idx] === 0) &&
                (mask.data[idx + 1] === 0) &&
                (mask.data[idx + 2] === 0)) {

                // change out's alpha to clear wherever mask is black
                out.data[idx + 3] = 0;
            }
            else {
                // alpha is opaque everywhere else
                out.data[idx + 3] = 255;
            }
        }
    }

    return out;
};
export { getPNG, getFrames, comparePNGs, applyMask }

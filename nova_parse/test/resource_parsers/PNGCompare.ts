import "jasmine";
import * as fs from "fs";
import { PNG } from "pngjs";


export function getPNG(path: string): Promise<PNG> {
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

export function getFrames(png: PNG, dim: { width: number, height: number }) {

    // dim is dim of each frame;
    //assert.equal(png.height % dim.height, 0);
    //assert.equal(png.width % dim.width, 0);

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


export const PNGCustomMatchers: jasmine.CustomMatcherFactories = {
    toEqualPNG: function() {
        return {
            compare: function(actual: unknown, expected: unknown):
                jasmine.CustomMatcherResult {
                if (!(actual instanceof PNG)) {
                    throw new Error(`${actual} is not a PNG object`);
                }
                if (!(expected instanceof PNG)) {
                    throw new Error(`${expected} is not a PNG object`);
                }

                if (expected.width != actual.width) {
                    return {
                        pass: false,
                        message: `expected width ${actual.width} to be ${expected.width}.`,
                    }
                }

                if (expected.height != actual.height) {
                    return {
                        pass: false,
                        message: `expected height ${actual.height} to be ${expected.height}.`,
                    }
                }

                if (expected.gamma != actual.gamma) {
                    return {
                        pass: false,
                        message: `expected gamma ${actual.gamma} to be ${expected.gamma}.`,
                    }
                }

                for (var y = 0; y < expected.height; y++) {
                    for (var x = 0; x < expected.width; x++) {
                        var idx = (expected.width * y + x) << 2;

                        // Ignore the color if alpha is zero
                        if ((expected.data[idx + 3] !== 0) || (actual.data[idx + 3]) !== 0) {
                            for (let color = idx; color <= idx + 3; color++) {
                                const expectedColor = expected.data[color];
                                const actualColor = actual.data[color];
                                if (expectedColor >> 3 !== actualColor >> 3) {
                                    return {
                                        pass: false,
                                        message: `expected color ${actualColor} to be ${expectedColor}.`,
                                    }
                                }
                            }
                        }
                    }
                }
                return {
                    pass: true
                }
            }
        }
    }
}

export function applyMask(image: PNG, mask: PNG) {
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

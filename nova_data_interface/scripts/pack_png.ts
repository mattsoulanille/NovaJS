import * as fs from 'fs';
import { ArgumentParser } from 'argparse';

function packPng(png: string, dest: string) {
    const buf = fs.readFileSync(png);
    const array = Uint8Array.from(buf);
    fs.writeFileSync(dest, `export default new Uint8Array(${JSON.stringify([...array])})`);
}

const parser = new ArgumentParser({
    description: 'PNG to typescript packer',
});

parser.add_argument('png_file');
parser.add_argument('destination');

const args = parser.parse_args();
packPng(args['png_file'], args['destination']);

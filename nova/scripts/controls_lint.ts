import { ArgumentParser } from 'argparse';
import { isLeft } from 'fp-ts/lib/Either';
import * as fs from 'fs';
import { Controls, SavedControls } from '../src/nova_plugin/controls';


const parser = new ArgumentParser({
    description: 'Lint a controls json file'
});

parser.add_argument('file', {
    type: String,
    help: 'The controls file to lint',
});

const args = parser.parse_args();
const file = fs.readFileSync(args.file, 'utf8');
const json = JSON.parse(file) as unknown;
const maybeSavedControls = SavedControls.decode(json);
if (isLeft(maybeSavedControls)) {
    for (const error of maybeSavedControls.left) {
        console.error(error);
    }
    throw new Error('Failed to decode');
}

const maybeControls = Controls.decode(maybeSavedControls.right);
if (isLeft(maybeControls)) {
    for (const error of maybeControls.left) {
        console.error(error);
    }
    throw new Error('Failed to decode');
}

const encoded = Controls.encode(maybeControls.right);

const saved = SavedControls.encode(encoded);
console.log(JSON.stringify(saved, null, 2));


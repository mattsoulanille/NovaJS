import { NovaFileReader } from "../src/NovaFileReader";


import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


it("comparePNGs should work for the same picture", function() {
    comparePNGs(starbridgePNG, starbridgePNG);
});

it("comparePNG should work for different pictures", function() {
    expect(function() {
        comparePNGs(starbridgePNG, starbridgeMask);
    }).to.throw();

});

it("getFrames should work", async function() {

    var starbridgeFrames = getFrames(starbridgePNG, { width: 48, height: 48 });

    var pngs: Array<PNG> = [];
    var promises: Array<Promise<void>> = [];
    for (var i = 0; i < 108; i++) {
        var path = "nova_parse/test/resource_parsers/files/rleds/testFrames/" + "starbridge" + i + ".png";
        promises.push(async function(): Promise<void> {
            var index = i;
            pngs[index] = await getPNG(path);
        }());
    }

    await Promise.all(promises);

    for (var i = 0; i < 108; i++) {
        comparePNGs(pngs[i], starbridgeFrames[i]);
    }

});

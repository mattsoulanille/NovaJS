import sys

pictureName = [sys.argv[1].split('.')[0], sys.argv[1].split('.')[1]]

pixelDimensions = [int(sys.argv[2].split(",")[0]), int(sys.argv[2].split(",")[1])]
pictureDimensions = [int(sys.argv[3].split(",")[0]), int(sys.argv[3].split(",")[1])]


output = '{"frames": {\n'
PicNum = 1
xstart = 0
ystart = 0
xstep = pixelDimensions[0]/pictureDimensions[0]
ystep = pixelDimensions[1]/pictureDimensions[1]




while ystart < pixelDimensions[1]:
    while xstart < pixelDimensions[0]:
        output = output + '"' + pictureName[0] + ' ' + str(PicNum) + '.' + pictureName[1] + '":\n'\
        + '{\n'\
        + '    "frame": {"x":' + str(xstart) + ',"y":' + str(ystart) + ',"w":' + str(xstep) + ',"h":' + str(ystep) + '},\n'\
        + '    "rotated": false,\n'\
        + '    "trimmed": false,\n'\
        + '    "spriteSourceSize": {"x":' + str(xstart) + ',"y":' + str(ystart) + ',"w":' + str(xstep) + ',"h":' + str(ystep) + '},\n'\
        + '    "sourceSize": {"w":' + str(xstep) + ',"h":' + str(ystep) + '}\n'\
        + '},\n'
        xstart += xstep
        print PicNum
        PicNum += 1
    xstart = 0
    ystart += ystep
    

output = output + '"meta": {\n'\
    + '    "image": "' + sys.argv[1] + '",\n'\
    + '    "format": "RGBA8888",\n'\
    + '    "size": {"w":' + str(pixelDimensions[0]) + ',"h":' + str(pixelDimensions[1]) + '},\n'\
    + '    "scale": "1"\n'\
    + '}\n}'
with open(pictureName[0] + '.json', 'w') as writeme:
    writeme.write(output)

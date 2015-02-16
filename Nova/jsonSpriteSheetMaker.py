import argparse, sys, pdb

class json_utils(object):
    def __init__(self, name, o):
        self.name = name.split('.')
        self.orientations = o

    def setOutFile(self, filePath):
        self.path = filePath
        self.outFile = open(filePath, 'w')

    def makeJson(self, px,py,x,y):
        output = '{"frames": {\n'
        PicNum = 1
        xstart = 0
        ystart = 0
        xstep = px/x
        ystep = py/y
        outfrags = []
        outfrags.append('{"frames": {\n')
#        pdb.set_trace()
        while ystart < py:
            while xstart < px:
                outfrags.append( '"' + self.name[0] + ' ' + str(PicNum) + '.' + self.name[1] + '":\n'\
                + '{\n'\
                + '    "frame": {"x":' + str(xstart) + ',"y":' + str(ystart) + ',"w":' + str(xstep) + ',"h":' + str(ystep) + '},\n'\
                + '    "rotated": false,\n'\
                + '    "trimmed": false,\n'\
                + '    "spriteSourceSize": {"x":' + str(xstart) + ',"y":' + str(ystart) + ',"w":' + str(xstep) + ',"h":' + str(ystep) + '},\n'\
                + '    "sourceSize": {"w":' + str(xstep) + ',"h":' + str(ystep) + '}\n'\
                + '}' )
                xstart += xstep
                if not (ystart + ystep == py and xstart == px):
                    outfrags.append(',\n')
#                if (PicNum >= 107):
 #                   pdb.set_trace()
                print PicNum
                PicNum += 1
            xstart = 0
            ystart += ystep

        outfrags.append('},\n')
        outfrags.append(
            '"meta": {\n' + 
            '    "image": "' + '.'.join(self.name) + '",\n' +
            '    "format": "RGBA8888",\n' +
            '    "size": {"w":' + str(px) + ',"h":' + str(py) + '},\n' +
            '    "scale": "1",\n'
            '    "imagePurposes": {"normal": {"start": 0, "length": ' + str(x*y / self.orientations) + ' }')
        if (self.orientations == 3):
            outfrags.append(
                '\n,        "left": {"start": ' + str(x*y / self.orientations) + ', "length": ' + str(x*y / self.orientations) + '},\n'
                '        "right": {"start": ' + str((x*y / self.orientations) * 2) + ', "length":' + str(x*y / self.orientations) + '}')
        outfrags.append('}\n}\n')
        


        self.output = ''.join(outfrags) + '}'
        
    def writeJson(self):
        self.outFile.write(self.output)

    

def main(argv):
    
    parser = argparse.ArgumentParser(description = "Tool to manipulate space object json files")
    parser.add_argument('path', type=str, help='Path to the json file to create')
    parser.add_argument('name', type=str, help='Name of the object (should be the same as the picture filename)')
    parser.add_argument('px', type=int, help='Picture x dimension in pixels')
    parser.add_argument('py', type=int, help='Picture y dimension in pixels')
    parser.add_argument('x', type=int, help='Number of sprite images in the x direction')
    parser.add_argument('y', type=int, help='Number of sprite images in the y direction')
    parser.add_argument('-t', '--turns', type=int, default=1, help='Number of orientations the sprite can have for turning purposes')

    args=parser.parse_args()
    jsonMaker = json_utils(args.name, args.turns)
    jsonMaker.setOutFile(args.path)
    jsonMaker.makeJson(args.px, args.py, args.x, args.y)
    jsonMaker.writeJson()


if __name__ == '__main__':
    main(sys.argv)

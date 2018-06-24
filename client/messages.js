class messages extends visible(function() {}) {
    constructor(dimensions) {
	super();
	this.dimensions = dimensions || {x:300, y:50};
	this.log = [];
	this.texts = [];
	this.font = {fontFamily:"Geneva", fontSize:12, fill:this.meta.colors.brightText, align:'center'};
	
    }


    showMessage(m) {
	this.log.push(m);
//	this.texts.push(new PIXI.Text(m, )
	this.render();
    }
    
    render() {
	
    }


};

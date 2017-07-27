"use strict";

var base = require("./base.js");

var shan = class extends base {

    constructor(resource) {
	super(...arguments);
	var d = this.data;
	var doImage = function(p,simple) {//10
	    var o = {};
	    o.ID = d.getInt16(p);
	    o.maskID = d.getInt16(p+2);
	    if (!simple){
		o.setCount = d.getInt16(p+4);
		p += 2;
	    }
	    o.size = [d.getInt16(p+4),d.getInt16(p+6)];
	    return o;
	};
	
	this.baseImage = doImage(0,false);
	this.baseImage.transparency = d.getInt16(10);
	this.altImage = doImage(12,false);
	this.glowImage = doImage(22,true);
	this.lightImage = doImage(30,true);
	this.weapImage = doImage(38,true);

	this.flagN = d.getInt16(46);
	this.flags = {}

	this.flags.extraFramePurpose = "unknown";

	if (this.flagN & 0x1)
	    this.flags.extraFramePurpose = "banking";
	if (this.flagN & 0x2)
	    this.flags.extraFramePurpose = "folding";
	if (this.flagN & 0x4)
	    this.flags.extraFramePurpose = "keyCarried";
	if (this.flagN & 0x8)
	    this.flags.extraFramePurpose = "animation";
	this.flags.displayEngineGlowWhenTurning = false;
	if ((this.flagN & 0x3) == 3){
	    this.flags.extraFramePurpose = "banking";
	    this.flags.displayEngineGlowWhenTurning = true;
	}
	this.flags.stopAnimationWhenDisabled = (this.flagN & 0x10) > 0;
	this.flags.hideAltSpritesWhenDisabled = (this.flagN & 0x20) > 0;
	this.flags.hideLightsWhenDisabled = (this.flagN & 0x40) > 0;
	this.flags.unfoldWhenFiring = (this.flagN & 0x80) > 0;
	this.flags.adjustForOffset = (this.flagN & 0x100) > 0;

	this.animDelay = d.getInt16(48);
	this.weapDecay = d.getInt16(50);
	this.framesPer = d.getInt16(52);
	this.blink = {};
	this.blink.modeN = d.getInt16(54);
	this.blink.a = d.getInt16(56);
	this.blink.b = d.getInt16(58);
	this.blink.c = d.getInt16(60);
	this.blink.d = d.getInt16(62);
	this.blink.mode = "unknown";
	switch (this.blink.modeN) { 
	case -1:
	    this.blink = null;
	    break;
	case 0:
	    this.blink = null;
	    break;
	case 1:
	    this.blink.mode = "square";
	    break;
	case 2:
	    this.blink.mode = "triangle";
	    break;
	case 3:
	    this.blink.mode = "random";
	    break;
	}
	
	
	this.shieldImage = doImage(64,true);
//	72
	
	var doPos = function(px,py,pz){
	    var o = [];
	    for (var i = 0; i < 4 ; i ++){
		o[i] = [d.getInt16(2*i+px),d.getInt16(2*i+py),d.getInt16(2*i+pz)];
	    }
	    return o;
	}
	this.exitPoints = {};
	this.exitPoints.gun = doPos(72,80,144);
	this.exitPoints.turret = doPos(88,96,152);
	this.exitPoints.guided = doPos(104,112,160);
	this.exitPoints.beam = doPos(120,128,168);

	this.exitPoints.upCompress = [d.getInt16(136),d.getInt16(138)];
	this.exitPoints.downCompress = [d.getInt16(140),d.getInt16(142)];
	
    }

};

module.exports = shan;


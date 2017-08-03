"use strict";

var base = require("./base.js");

var spin = class extends base {

    constructor(resource) {
	super(...arguments);

	var d = this.data;
	this.spriteID = d.getInt16(0);
	this.maskID = d.getInt16(2);
	this.spriteSize = [];
	this.spriteSize[0] = d.getInt16(4);
	this.spriteSize[1] = d.getInt16(6);
	this.spriteTiles = [];
	this.spriteTiles[0] = d.getInt16(8);
	this.spriteTiles[1] = d.getInt16(10);
	this.imageType;
	this.type = "Unknown";
	
	//switch
	if (this.spriteID >= 400 && this.spriteID <= 463) { 
	    this.type = "Explosion";}
	if (this.spriteID == 500) {
	    this.type = "Cargo box";}
	if (this.spriteID >= 501 && this.spriteID <= 504) { 
	    this.type = "Mineral";}
	if (this.spriteID >= 600 && this.spriteID <= 605) { 
	    this.type = "Main menu button";}
	if (this.spriteID == 606){
	    this.type = "Main screen logo";}
	if (this.spriteID == 607){
	    this.type = "Main screen rollover image";}
	if (this.spriteID >= 608 && this.spriteID <= 610) { 
	    this.type = "Main screen sliding button";}
	if (this.spriteID == 650){
	    this.type = "Target cursor";}
	if (this.spriteID == 700) { 
	    this.type = "Starfield";}
	if (this.spriteID >= 800 && this.spriteID <= 815) { 
	    this.type = "Asteriod";}
	if (this.spriteID >= 1000 && this.spriteID <= 1255) { 
	    this.type = "Stellar object";}
	if (this.spriteID >= 3000 && this.spriteID <= 3255) { 
	    this.type = "Weapon";}
	//end switch



	this.imageType = "rled";//for now
    }

};
module.exports = spin;

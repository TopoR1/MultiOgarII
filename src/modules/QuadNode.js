/*
 * Fast and easy Quad-Tree implementation written by Barbosik.
 * Useful for quick object search in the area specified with bounds.
 *
 * Copyright (c) 2016 Barbosik https://github.com/Barbosik
 * License: Apache License, Version 2.0
 */

const maxItemCount = 64;

class Quad {
    constructor(minx, miny, maxx, maxy) {
        this.minx = minx;
        this.miny = miny;
        this.maxx = maxx;
        this.maxy = maxy;
    }
    overlaps(/* Quad */other) {
        return !(this.minx >= other.maxx || this.maxx <= other.minx
            || this.miny >= other.maxy || this.maxy <= other.miny);
    }
}

class QuadNode {
    constructor(bound) {
        this.halfWidth = (bound.maxx - bound.minx) / 2;
        this.halfHeight = (bound.maxy - bound.miny) / 2;
        this.bound = bound;
        this.bound.cx = bound.minx + this.halfWidth;
        this.bound.cy = bound.miny + this.halfHeight;
        this.childNodes = [];
        this.items = [];
    }
    insert(item) {
        if (this.childNodes.length != 0) {
            const quad = this.getQuad(item.bound);
            if (quad !== -1)
                return this.childNodes[quad].insert(item);
        }
        this.items.push(item);
        item._quadNode = this; // used for quick search quad node by item
        // split and rebalance current node
        if (this.childNodes.length == 0 && this.items.length > maxItemCount) {
            // split into 4 subnodes
            const minx = this.bound.minx;
            const miny = this.bound.miny;
            const midx = this.bound.cx;
            const midy = this.bound.cy;
            const maxx = this.bound.maxx;
            const maxy = this.bound.maxy;
            const nw = new Quad(minx, miny, midx, midy);
            const ne = new Quad(midx, miny, maxx, midy);
            const sw = new Quad(minx, midy, midx, maxy);
            const se = new Quad(midx, midy, maxx, maxy);
            this.childNodes.push(new QuadNode(nw));
            this.childNodes.push(new QuadNode(ne));
            this.childNodes.push(new QuadNode(sw));
            this.childNodes.push(new QuadNode(se));
        }
    }
    remove(item) {
        if (item._quadNode !== this)
            return item._quadNode.remove(item);
        this.items.splice(this.items.indexOf(item), 1);
        item._quadNode = null;
    }
    find(bound, callback) { // returns bool found
        for (const childNode of this.childNodes) {
            if (bound.overlaps(childNode.bound))
                if (childNode.find(bound, callback))
                    return true;
        }
        for (const item of this.items) {
            if (bound.overlaps(item.bound))
                if (callback(item.cell))
                    return true;
        }
        return false;
    }
    // Returns quadrant for the bound.
    // Returns -1 if bound cannot completely fit within a child node
    getQuad(bound) {
        if (bound.maxx <= this.bound.cx) { // left
            if (bound.maxy <= this.bound.cy) // top
                return 0;
            if (bound.miny >= this.bound.cy) // bottom
                return 2;
        } else if (bound.minx >= this.bound.cx) { // right
            if (bound.maxy <= this.bound.cy) // top
                return 1;
            if (bound.miny >= this.bound.cy) // bottom
                return 3;
        }
        return -1;
    }
}

module.exports = {QuadNode: QuadNode, Quad: Quad};

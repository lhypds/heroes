import { Component } from "react";

// Holds a piece of the page up when it throws while drawing itself. React
// takes the whole page down otherwise — every component of it, back to a blank
// window — and a blank window says nothing to whoever is looking at it and
// nothing to whoever has to find out why.
//
// What it wraps is the part that draws what a server said, since that is where
// a page and the thing answering it can fall out of step: an answer kept in a
// browser from before a deployment has the shape of the code of its day, and a
// field the page reads may not be in it. The rest of the page is built from
// files at build time and stands whatever happens here.
//
// `say` is what to put in its place, and `children` is what it holds up.
export default class Boundary extends Component {
  state = { fell: false };

  static getDerivedStateFromError() {
    return { fell: true };
  }

  componentDidCatch(error) {
    // For whoever opens the console; the page itself says the short version.
    console.error(`this part of the page could not be drawn: ${error.message}`);
  }

  render() {
    return this.state.fell ? <p className={this.props.className}>{this.props.say}</p> : this.props.children;
  }
}

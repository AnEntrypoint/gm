/* eslint-disable */
import {
  ElementProps,
  JSXElementProps,
  NonBooleanPrimitive,
  VElement
} from "./types.js";

declare global {
  namespace JSX {
    /**
     * Common attributes available to all elements
     */
    interface IntrinsicAttributes {
      key?: NonBooleanPrimitive;
    }

    /**
     * Base interface for JSX elements
     */
    interface Element extends VElement {
      type: string;
      props: ElementProps;
    }

    /**
     * Helper type for extracting element attributes
     */
    type ElementAttributesFor<T extends Node> = Partial<{
      [K in Exclude<keyof T, "children" | "nodes">]: T[K] extends Function
        ? T[K]
        : T[K] | string;
    }> &
      JSXElementProps;

    /**
     * Maps HTML and SVG element types to their attribute types
     */
    type DOMIntrinsicElements = {
      [K in keyof HTMLElementTagNameMap]: ElementAttributesFor<
        HTMLElementTagNameMap[K]
      >;
    } & {
      [K in keyof SVGElementTagNameMap]: ElementAttributesFor<
        SVGElementTagNameMap[K]
      >;
    };

    /**
     * Intrinsic elements interface - can be augmented by consumers
     */
    interface IntrinsicElements extends DOMIntrinsicElements {
      // Empty to allow merging
    }
  }
}

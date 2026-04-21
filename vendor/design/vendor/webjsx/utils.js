import { HTML_NAMESPACE } from "./constants.js";
/**
 * Flattens nested virtual nodes by replacing Fragments with their children.
 * @param vnodes Virtual nodes to flatten
 * @returns Array of flattened virtual nodes
 */
export function flattenVNodes(vnodes, result = []) {
    if (Array.isArray(vnodes)) {
        for (const vnode of vnodes) {
            flattenVNodes(vnode, result);
        }
    }
    else if (isValidVNode(vnodes)) {
        result.push(vnodes);
    }
    return result;
}
export function isValidVNode(vnode) {
    const typeofVNode = typeof vnode;
    return (vnode !== null &&
        vnode !== undefined &&
        (typeofVNode === "string" ||
            typeofVNode === "object" ||
            typeofVNode === "number" ||
            typeofVNode === "bigint"));
}
/* Get Child Nodes Efficiently */
export function getChildNodes(parent) {
    const nodes = [];
    let current = parent.firstChild;
    while (current) {
        nodes.push(current);
        current = current.nextSibling;
    }
    return nodes;
}
/**
 * Assigns a ref to a DOM node.
 * @param node Target DOM node
 * @param ref Reference to assign (function or object with current property)
 */
export function assignRef(node, ref) {
    if (typeof ref === "function") {
        ref(node);
    }
    else if (ref && typeof ref === "object") {
        ref.current = node;
    }
}
export function isVElement(vnode) {
    const typeofVNode = typeof vnode;
    return (typeofVNode !== "string" &&
        typeofVNode !== "number" &&
        typeofVNode !== "bigint");
}
export function isNonBooleanPrimitive(vnode) {
    const typeofVNode = typeof vnode;
    return (typeofVNode === "string" ||
        typeofVNode === "number" ||
        typeofVNode === "bigint");
}
export function getNamespaceURI(node) {
    return node instanceof Element && node.namespaceURI !== HTML_NAMESPACE
        ? node.namespaceURI ?? undefined
        : undefined;
}
export function setWebJSXProps(element, props) {
    element.__webjsx_props = props;
}
export function getWebJSXProps(element) {
    let props = element.__webjsx_props;
    if (!props) {
        props = {};
        element.__webjsx_props = props;
    }
    return props;
}
export function setWebJSXChildNodeCache(element, childNodes) {
    element.__webjsx_childNodes = childNodes;
}
export function getWebJSXChildNodeCache(element) {
    return element.__webjsx_childNodes;
}
//# sourceMappingURL=utils.js.map
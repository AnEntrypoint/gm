/* eslint-disable @typescript-eslint/no-explicit-any */
import { definesRenderSuspension, withRenderSuspension, } from "./renderSuspension.js";
/**
 * Updates an event listener on an element.
 * @param el Target element
 * @param eventName Name of the event (without 'on' prefix)
 * @param newHandler New event handler function
 * @param oldHandler Previous event handler function
 */
function updateEventListener(el, eventName, newHandler, oldHandler) {
    if (oldHandler && oldHandler !== newHandler) {
        el.removeEventListener(eventName, oldHandler);
    }
    if (newHandler && oldHandler !== newHandler) {
        el.addEventListener(eventName, newHandler);
        el.__webjsx_listeners =
            el.__webjsx_listeners ?? {};
        el.__webjsx_listeners[eventName] = newHandler;
    }
}
/**
 * Updates a single property or attribute on an element.
 * @param el Target element
 * @param key Property or attribute name
 * @param value New value to set
 */
function updatePropOrAttr(el, key, value) {
    if (el instanceof HTMLElement) {
        if (key in el) {
            // Fast path: property exists on HTMLElement
            el[key] = value;
            return;
        }
        if (typeof value === "string") {
            el.setAttribute(key, value);
            return;
        }
        // Fallback for non-string values on HTMLElement
        el[key] = value;
        return;
    }
    // SVG/Other namespace elements
    const isSVG = el.namespaceURI === "http://www.w3.org/2000/svg";
    if (isSVG) {
        if (value !== undefined && value !== null) {
            el.setAttribute(key, `${value}`);
        }
        else {
            el.removeAttribute(key);
        }
        return;
    }
    // Fallback for other element types
    if (typeof value === "string") {
        el.setAttribute(key, value);
    }
    else {
        el[key] = value;
    }
}
/**
 * Updates all attributes and properties on a DOM element.
 * @param el Target element
 * @param newProps New properties to apply
 * @param oldProps Previous properties for comparison (default empty object)
 */
function updateAttributesCore(el, newProps, oldProps = {}) {
    // Handle new/updated props
    for (const key of Object.keys(newProps)) {
        const value = newProps[key];
        if (key === "children" ||
            key === "key" ||
            key === "dangerouslySetInnerHTML" ||
            key === "nodes")
            continue;
        if (key.startsWith("on") && typeof value === "function") {
            const eventName = key.substring(2).toLowerCase();
            updateEventListener(el, eventName, value, el.__webjsx_listeners?.[eventName]);
        }
        else if (value !== oldProps[key]) {
            updatePropOrAttr(el, key, value);
        }
    }
    // Handle dangerouslySetInnerHTML
    if (newProps.dangerouslySetInnerHTML) {
        if (!oldProps.dangerouslySetInnerHTML ||
            newProps.dangerouslySetInnerHTML.__html !==
                oldProps.dangerouslySetInnerHTML.__html) {
            const html = newProps.dangerouslySetInnerHTML?.__html || "";
            el.innerHTML = html;
        }
    }
    else {
        if (oldProps.dangerouslySetInnerHTML) {
            el.innerHTML = "";
        }
    }
    // Remove old props/attributes
    for (const key of Object.keys(oldProps)) {
        if (!(key in newProps) &&
            key !== "children" &&
            key !== "key" &&
            key !== "dangerouslySetInnerHTML" &&
            key !== "nodes") {
            if (key.startsWith("on")) {
                const eventName = key.substring(2).toLowerCase();
                const existingListener = el
                    .__webjsx_listeners?.[eventName];
                if (existingListener) {
                    el.removeEventListener(eventName, existingListener);
                    delete el.__webjsx_listeners[eventName];
                }
            }
            else if (key in el) {
                el[key] = undefined;
            }
            else {
                el.removeAttribute(key);
            }
        }
    }
}
/**
 * Sets initial attributes and properties on a DOM element.
 * @param el Target element
 * @param props Properties to apply
 */
export function setAttributes(el, props) {
    if (definesRenderSuspension(el)) {
        withRenderSuspension(el, () => {
            updateAttributesCore(el, props);
        });
    }
    else {
        updateAttributesCore(el, props);
    }
}
/**
 * Updates existing attributes and properties on a DOM element.
 * @param el Target element
 * @param newProps New properties to apply
 * @param oldProps Previous properties for comparison
 */
export function updateAttributes(el, newProps, oldProps) {
    if (definesRenderSuspension(el)) {
        withRenderSuspension(el, () => {
            updateAttributesCore(el, newProps, oldProps);
        });
    }
    else {
        updateAttributesCore(el, newProps, oldProps);
    }
}
//# sourceMappingURL=attributes.js.map
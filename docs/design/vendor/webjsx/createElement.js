import { KNOWN_ELEMENTS } from "./elementTags.js";
import { flattenVNodes } from "./utils.js";
/**
 * Creates a virtual element representing a DOM node or Fragment.
 * @param type Element type (tag name) or Fragment
 * @param props Properties and attributes for the element
 * @param children Child elements or content
 * @returns Virtual element representation
 */
export function createElement(type, props, ...children) {
    if (typeof type === "string") {
        const normalizedProps = props ? props : {};
        const flatChildren = flattenVNodes(children);
        if (flatChildren.length > 0) {
            // Set children property only if dangerouslySetInnerHTML is not present
            if (!normalizedProps.dangerouslySetInnerHTML) {
                normalizedProps.children = flatChildren;
            }
            else {
                normalizedProps.children = [];
                console.warn("WebJSX: Ignoring children since dangerouslySetInnerHTML is set.");
            }
        }
        else {
            normalizedProps.children = [];
        }
        const result = {
            type,
            tagName: KNOWN_ELEMENTS.get(type) ?? type.toUpperCase(),
            props: normalizedProps ?? {},
        };
        return result;
    }
    else {
        return flattenVNodes(children);
    }
}
// As called from jsx-runtime.jsx function.
export function createElementJSX(type, props, key) {
    if (typeof type === "string") {
        props = props || {};
        const flatChildren = props
            ? flattenVNodes(props.children)
            : [];
        if (key !== undefined) {
            props.key = key;
        }
        if (flatChildren.length > 0) {
            // Set children property only if dangerouslySetInnerHTML is not present
            if (!props.dangerouslySetInnerHTML) {
                props.children = flatChildren;
            }
            else {
                props.children = [];
                console.warn("WebJSX: Ignoring children since dangerouslySetInnerHTML is set.");
            }
        }
        else {
            props.children = [];
        }
        const result = {
            type,
            tagName: KNOWN_ELEMENTS.get(type) ?? type.toUpperCase(),
            props: props ?? {},
        };
        return result;
    }
    else {
        const flatChildren = props
            ? flattenVNodes(props.children)
            : [];
        return flatChildren;
    }
}
//# sourceMappingURL=createElement.js.map
const PLATFORM_FEATURES = [
  { title: 'State Machine', desc: 'Immutable PLAN\u2192EXECUTE\u2192EMIT\u2192VERIFY\u2192COMPLETE phases with full mutable tracking' },
  { title: 'Semantic Search', desc: 'Natural language codebase exploration via codesearch skill \u2014 no grep needed' },
  { title: 'Hooks', desc: 'Pre-tool, session-start, prompt-submit, and stop hooks for full lifecycle control' },
  { title: 'Agents', desc: 'gm, codesearch, and websearch agents pre-configured and ready to use' },
  { title: 'MCP Integration', desc: 'Model Context Protocol server support built in' },
  { title: 'Auto-Recovery', desc: 'Supervisor hierarchy ensures the system never crashes' }
];

const PLATFORM_META = {
  cc: { repoId: 'gm-cc', label: 'Claude Code', type: 'cli', badgeLabel: 'cc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-cc' }, { desc: 'Restart Claude Code \u2014 activates automatically' }] },
  gc: { repoId: 'gm-gc', label: 'Gemini CLI', type: 'cli', badgeLabel: 'gc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-gc' }, { desc: 'Restart Gemini CLI \u2014 hooks activate on next session' }] },
  oc: { repoId: 'gm-oc', label: 'OpenCode', type: 'cli', badgeLabel: 'oc', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-oc' }, { desc: 'Restart OpenCode \u2014 activates automatically' }] },
  kilo: { repoId: 'gm-kilo', label: 'Kilo Code', type: 'cli', badgeLabel: 'kilo', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-kilo' }, { desc: 'Restart Kilo Code \u2014 activates automatically' }] },
  codex: { repoId: 'gm-codex', label: 'Codex', type: 'cli', badgeLabel: 'codex', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-codex' }, { desc: 'Restart Codex \u2014 activates automatically' }] },
  'copilot-cli': { repoId: 'gm-copilot-cli', label: 'Copilot CLI', type: 'cli', badgeLabel: 'copilot-cli', installSteps: [{ desc: 'Install via GitHub CLI', cmd: 'gh extension install AnEntrypoint/gm-copilot-cli' }, { desc: 'Restart your terminal \u2014 activates automatically' }] },
  vscode: { repoId: 'gm-vscode', label: 'VS Code', type: 'ide', badgeLabel: 'vscode', installSteps: [{ desc: 'Open Extensions (Ctrl+Shift+X), search "gm", click Install' }, { desc: 'Reload VS Code \u2014 activates automatically' }] },
  cursor: { repoId: 'gm-cursor', label: 'Cursor', type: 'ide', badgeLabel: 'cursor', installSteps: [{ desc: 'Open Extensions (Ctrl+Shift+X), search "gm", click Install' }, { desc: 'Reload Cursor \u2014 activates automatically' }] },
  zed: { repoId: 'gm-zed', label: 'Zed', type: 'ide', badgeLabel: 'zed', installSteps: [{ desc: 'Build from source', cmd: 'git clone https://github.com/AnEntrypoint/gm-zed && cd gm-zed && cargo build --release' }, { desc: 'Copy to extensions dir', cmd: 'cp target/release/libgm.so ~/.config/zed/extensions/gm/' }, { desc: 'Restart Zed \u2014 activates automatically' }] },
  jetbrains: { repoId: 'gm-jetbrains', label: 'JetBrains', type: 'ide', badgeLabel: 'jetbrains', installSteps: [{ desc: 'Preferences \u2192 Plugins \u2192 Marketplace, search "gm", click Install' }, { desc: 'Restart IDE \u2014 activates automatically' }] },
  qwen: { repoId: 'gm-qwen', label: 'Qwen Code', type: 'cli', badgeLabel: 'qwen', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-qwen' }, { desc: 'Restart Qwen Code \u2014 activates automatically' }] },
  hermes: { repoId: 'gm-hermes', label: 'Hermes Agent', type: 'cli', badgeLabel: 'hermes', installSteps: [{ desc: 'Install via npm', cmd: 'npm install -g gm-hermes' }, { desc: 'Restart Hermes Agent \u2014 skills activate automatically' }] }
};

function getPlatformPageConfig(adapterName, pluginSpec) {
  const m = PLATFORM_META[adapterName] || { repoId: `gm-${adapterName}`, label: adapterName, type: 'cli', badgeLabel: adapterName, installSteps: [] };
  return {
    name: m.repoId,
    label: m.label,
    description: pluginSpec.description,
    type: m.type,
    version: pluginSpec.version,
    installSteps: m.installSteps,
    features: PLATFORM_FEATURES,
    githubUrl: `https://github.com/AnEntrypoint/${m.repoId}`,
    badgeLabel: m.badgeLabel,
    currentPlatform: m.repoId
  };
}

function generateGitHubPage(config) {
  const { name, label, description, type, version, installSteps, features, githubUrl, badgeLabel, currentPlatform } = config;
  const featuresJson = JSON.stringify(features || []);
  const installStepsJson = JSON.stringify(installSteps || []);
  const typeLabel = type === 'cli' ? 'CLI Tool' : type === 'hub' ? 'Plugin Generator' : 'IDE Extension';
  const typeBadgeColor = type === 'cli' ? '#3b82f6' : type === 'hub' ? '#059669' : '#8b5cf6';
  const GH_PATH = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${label} - gm plugin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  
  <style>
    body{background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;margin:0}
    .gradient-hero{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)}
    .card-hover{transition:transform .2s,box-shadow .2s}
    .card-hover:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(0,0,0,.3)}
    pre{scrollbar-width:thin;background:#020617;border:1px solid #1e293b;border-radius:8px;padding:12px 16px;color:#4ade80;overflow-x:auto;font-size:.875rem}
  </style>
</head>
<body>
<script>
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const MATH_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const Fragment = (props) => {
    return props.children
        ? Array.isArray(props.children)
            ? props.children
            : [props.children]
        : [];
};

/**
 * Handles event listener updates for an element
 */
function updateEventListener(el, eventName, newHandler, oldHandler) {
    if (oldHandler && oldHandler !== newHandler) {
        el.removeEventListener(eventName, oldHandler);
    }
    if (newHandler && oldHandler !== newHandler) {
        el.addEventListener(eventName, newHandler);
        el.__webjsx_listeners = {
            ...(el.__webjsx_listeners || {}),
            [eventName]: newHandler,
        };
    }
}
/**
 * Updates a single property or attribute on an element
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
        if (value != null) {
            el.setAttribute(key, value.toString());
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
 * Handles suspension of rendering during updates
 */
function withRenderSuspension(el, callback) {
    const isRenderingSuspended = !!el
        .__webjsx_suspendRendering;
    if (isRenderingSuspended) {
        el.__webjsx_suspendRendering();
    }
    try {
        return callback();
    }
    finally {
        if (isRenderingSuspended) {
            el.__webjsx_resumeRendering();
        }
    }
}
/**
 * Core function to update attributes and properties on a DOM element
 */
function updateAttributesCore(el, newProps, oldProps = {}) {
    // Handle new/updated props
    for (const [key, value] of Object.entries(newProps)) {
        if (key === "children" ||
            key === "key" ||
            key === "dangerouslySetInnerHTML")
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
    if ("dangerouslySetInnerHTML" in newProps) {
        const html = newProps.dangerouslySetInnerHTML.__html || "";
        el.innerHTML = html;
    }
    else if ("dangerouslySetInnerHTML" in oldProps) {
        el.innerHTML = "";
    }
    // If this is a fresh set (no oldProps), remove any attributes not in newProps
    if (Object.keys(oldProps).length === 0) {
        const currentAttrs = Array.from(el.attributes).map((attr) => attr.name);
        for (const attr of currentAttrs) {
            if (!(attr in newProps) && !attr.startsWith("on")) {
                el.removeAttribute(attr);
            }
        }
    }
    // Remove old props/attributes
    for (const key of Object.keys(oldProps)) {
        if (!(key in newProps) &&
            key !== "children" &&
            key !== "key" &&
            key !== "dangerouslySetInnerHTML") {
            if (key.startsWith("on")) {
                const eventName = key.substring(2).toLowerCase();
                const existingListener = el.__webjsx_listeners?.[eventName];
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
    // Store current props for future updates
    el.__webjsx_props = newProps;
}
/**
 * Sets attributes and properties on a DOM element based on the provided props.
 * If the property exists on the element, it sets it as a property.
 * Otherwise, it sets it as an attribute or property based on the value type.
 *
 * @param el - The DOM element to update.
 * @param props - The new properties to apply.
 */
function setAttributes(el, props) {
    withRenderSuspension(el, () => {
        updateAttributesCore(el, props);
    });
}
/**
 * Updates attributes and properties on a DOM element based on the new and old props.
 *
 * @param el - The DOM element to update.
 * @param newProps - The new properties to apply.
 * @param oldProps - The old properties to compare against.
 */
function updateAttributes(el, newProps, oldProps) {
    withRenderSuspension(el, () => {
        updateAttributesCore(el, newProps, oldProps);
    });
}

function isFragment(type) {
    return type === Fragment;
}
function createNode(vnode, parentNamespaceURI) {
    if (typeof vnode === "string" ||
        typeof vnode === "number" ||
        typeof vnode === "boolean") {
        return document.createTextNode(String(vnode));
    }
    else if (isFragment(vnode.type)) {
        const fragment = document.createDocumentFragment();
        if (vnode.props.children) {
            const children = vnode.props.children;
            children.forEach((child) => {
                fragment.appendChild(createNode(child, undefined));
            });
        }
        return fragment;
    }
    else {
        const namespaceURI = vnode.props.xmlns !== undefined
            ? vnode.props.xmlns
            : vnode.type === "svg"
                ? SVG_NAMESPACE
                : parentNamespaceURI ?? undefined;
        const el = vnode.props.is !== undefined
            ? namespaceURI !== undefined
                ? document.createElementNS(namespaceURI, vnode.type, {
                    is: vnode.props.is,
                })
                : document.createElement(vnode.type, {
                    is: vnode.props.is,
                })
            : namespaceURI !== undefined
                ? document.createElementNS(namespaceURI, vnode.type)
                : document.createElement(vnode.type);
        if (vnode.props) {
            setAttributes(el, vnode.props);
        }
        if (vnode.props.key != null) {
            el.__webjsx_key = vnode.props.key;
            el.setAttribute("data-key", String(vnode.props.key));
        }
        if (vnode.props.ref) {
            assignRef(el, vnode.props.ref);
        }
        if (vnode.props.children && !vnode.props.dangerouslySetInnerHTML) {
            const children = vnode.props.children;
            children.forEach((child) => {
                el.appendChild(createNode(child, namespaceURI));
            });
        }
        return el;
    }
}
/**
 * Assigns a ref to a node.
 * @param node The DOM node.
 * @param ref The ref to assign.
 */
function assignRef(node, ref) {
    const currentRef = node.__webjsx_assignedRef;
    // Only assign the ref if it's different
    if (currentRef !== ref) {
        if (typeof ref === "function") {
            ref(node);
        }
        else if (ref && typeof ref === "object") {
            ref.current = node;
        }
        // Store the assigned ref
        node.__webjsx_assignedRef = ref;
    }
}

function createElement(type, props, ...children) {
    const normalizedProps = props ? { ...props } : {};
    const flatChildren = [];
    const flatten = (child) => {
        if (Array.isArray(child)) {
            child.forEach(flatten);
        }
        else if (typeof child === "string" || typeof child === "number") {
            flatChildren.push(child);
        }
        else if (child === null ||
            child === undefined ||
            typeof child === "boolean") {
            // Ignore null or undefined children
        }
        else {
            flatChildren.push(child);
        }
    };
    children.forEach(flatten);
    if (flatChildren.length > 0) {
        // Only set children if dangerouslySetInnerHTML is not present
        if (!normalizedProps.dangerouslySetInnerHTML) {
            normalizedProps.children = flatChildren;
        }
        else {
            console.warn("WebJSX: Ignoring children since dangerouslySetInnerHTML is set.");
        }
    }
    return {
        type,
        props: normalizedProps,
    };
}

/**
 * Applies the differences between the new virtual node(s) and the existing DOM.
 * @param parent The parent DOM node where the virtual nodes will be applied.
 * @param newVirtualNode A single virtual node or an array of virtual nodes.
 */
function applyDiff(parent, newVirtualNode) {
    const newVNodes = Array.isArray(newVirtualNode)
        ? newVirtualNode
        : [newVirtualNode];
    diffChildren(parent, newVNodes);
}
/**
 * Flattens the list of virtual nodes by replacing Fragments with their children.
 * @param vnodes The array of virtual nodes to flatten.
 * @returns A new array of virtual nodes with Fragments flattened.
 */
function flattenVNodes(vnodes) {
    const flat = [];
    const arrayVNodes = vnodes;
    arrayVNodes.forEach((vnode) => {
        if (isFragment(vnode)) {
            const children = vnode.props.children ? vnode.props.children : [];
            flat.push(...children);
        }
        else {
            flat.push(vnode);
        }
    });
    return flat;
}
/**
 * Type guard to check if a VNode is a Fragment.
 * @param vnode The virtual node to check.
 * @returns True if vnode is a Fragment, false otherwise.
 */
function isFragment(vnode) {
    return typeof vnode === "object" && vnode !== null && vnode.type === Fragment;
}
/**
 * Diffs and updates the children of a DOM node based on the new virtual nodes.
 * @param parent The parent DOM node whose children will be diffed.
 * @param newVNodes An array of new virtual nodes.
 */
function diffChildren(parent, newVNodes) {
    const flattenedVNodes = flattenVNodes(newVNodes);
    const existingNodes = Array.from(parent.childNodes);
    const keyedMap = new Map();
    // Populate keyedMap with existing keyed nodes
    existingNodes.forEach((node) => {
        const key = node.__webjsx_key;
        if (key != null) {
            keyedMap.set(key, node);
        }
    });
    const newKeys = flattenedVNodes
        .filter(isVElementWithKey)
        .map((vnode) => vnode.props.key);
    existingNodes.forEach((node) => {
        const key = node.__webjsx_key;
        if (key != null && !newKeys.includes(key)) {
            parent.removeChild(node);
        }
    });
    flattenedVNodes.forEach((newVNode, i) => {
        const newKey = isVElement(newVNode) ? newVNode.props.key : undefined;
        let existingNode = null;
        if (newKey != null) {
            existingNode = keyedMap.get(newKey) || null;
        }
        if (!existingNode && newKey == null) {
            existingNode = parent.childNodes[i] || null;
        }
        if (existingNode) {
            if (existingNode !== parent.childNodes[i]) {
                parent.insertBefore(existingNode, parent.childNodes[i] || null);
            }
            updateNode(existingNode, newVNode);
        }
        else {
            const newDomNode = createNode(newVNode, getNamespaceURI(parent));
            if (isVElement(newVNode) && newVNode.props.key != null) {
                newDomNode.__webjsx_key = newVNode.props.key;
                newDomNode.setAttribute("data-key", String(newVNode.props.key));
            }
            parent.insertBefore(newDomNode, parent.childNodes[i] || null);
        }
    });
    const updatedChildNodes = Array.from(parent.childNodes);
    const newUnkeyed = flattenedVNodes.filter((vnode) => !isVElementWithKey(vnode));
    const existingUnkeyed = updatedChildNodes.filter((node) => !node.__webjsx_key);
    if (newUnkeyed.length < existingUnkeyed.length) {
        for (let i = newUnkeyed.length; i < existingUnkeyed.length; i++) {
            parent.removeChild(existingUnkeyed[i]);
        }
    }
}
/**
 * Updates a DOM node to match the new virtual node.
 * @param domNode The existing DOM node to be updated.
 * @param newVNode The new virtual node to apply.
 */
function updateNode(domNode, newVNode) {
    if (typeof newVNode === "string" ||
        typeof newVNode === "number" ||
        typeof newVNode === "boolean") {
        if (domNode.nodeType !== Node.TEXT_NODE ||
            domNode.textContent !== String(newVNode)) {
            const newTextNode = document.createTextNode(String(newVNode));
            domNode.parentNode?.replaceChild(newTextNode, domNode);
        }
        return;
    }
    if (newVNode.type === Fragment) {
        if (domNode instanceof DocumentFragment) {
            diffChildren(domNode, newVNode.props.children ? newVNode.props.children : []);
        }
        else {
            const fragment = document.createDocumentFragment();
            const children = newVNode.props.children ? newVNode.props.children : [];
            children.forEach((child) => {
                fragment.appendChild(createNode(child, undefined));
            });
            domNode.parentNode?.replaceChild(fragment, domNode);
        }
        return;
    }
    if (domNode instanceof HTMLElement &&
        domNode.tagName.toLowerCase() === newVNode.type.toLowerCase()) {
        const oldProps = domNode.__webjsx_props || {};
        const newProps = newVNode.props || {};
        updateAttributes(domNode, newProps, oldProps);
        if (isVElement(newVNode) && newVNode.props.key != null) {
            domNode.__webjsx_key = newVNode.props.key;
            domNode.setAttribute("data-key", String(newVNode.props.key));
        }
        else {
            delete domNode.__webjsx_key;
            domNode.removeAttribute("data-key");
        }
        if (newProps.ref) {
            assignRef(domNode, newProps.ref);
        }
        if (!newProps.dangerouslySetInnerHTML && newProps.children != null) {
            diffChildren(domNode, newProps.children);
        }
    }
    else {
        const newDomNode = createNode(newVNode, domNode.parentNode ? getNamespaceURI(domNode.parentNode) : undefined);
        if (isVElement(newVNode) && newVNode.props.key != null) {
            newDomNode.__webjsx_key = newVNode.props.key;
            newDomNode.setAttribute("data-key", String(newVNode.props.key));
        }
        if (isVElement(newVNode) && newVNode.props.ref) {
            assignRef(newDomNode, newVNode.props.ref);
        }
        domNode.parentNode?.replaceChild(newDomNode, domNode);
    }
}
/**
 * Assigns a ref to a node.
 * @param node The DOM node.
 * @param ref The ref to assign.
 */
function assignRef(node, ref) {
    const currentRef = node.__webjsx_assignedRef;
    // Only assign the ref if it's different
    if (currentRef !== ref) {
        if (typeof ref === "function") {
            ref(node);
        }
        else if (ref && typeof ref === "object") {
            ref.current = node;
        }
        // Store the assigned ref
        node.__webjsx_assignedRef = ref;
    }
}
/**
 * Type guard to check if a VNode is a VElement.
 * @param vnode The virtual node to check.
 * @returns True if vnode is a VElement, false otherwise.
 */
function isVElement(vnode) {
    return typeof vnode === "object" && vnode !== null && "props" in vnode;
}
/**
 * Type guard to check if a VNode is a VElement with a key.
 * @param vnode The virtual node to check.
 * @returns True if vnode is a VElement with a key, false otherwise.
 */
function isVElementWithKey(vnode) {
    return isVElement(vnode) && vnode.props.key != null;
}
function getNamespaceURI(node) {
    return node instanceof Element && node.namespaceURI !== HTML_NAMESPACE
        ? node.namespaceURI ?? undefined
        : undefined;
}

const h = createElement;

const PLATFORM_NAME=${JSON.stringify(label)},PLATFORM_TYPE=${JSON.stringify(typeLabel)},PLATFORM_TYPE_COLOR=${JSON.stringify(typeBadgeColor)};
const DESCRIPTION=${JSON.stringify(description)},VERSION=${JSON.stringify(version||'2.0.0')};
const GITHUB_URL=${JSON.stringify(githubUrl||'#')},BADGE_LABEL=${JSON.stringify(badgeLabel||name)};
const FEATURES=${featuresJson},INSTALL_STEPS=${installStepsJson};
const CURRENT_PLATFORM=${JSON.stringify(currentPlatform||name)};
const ALL_PLATFORMS=[
  {id:'gm-cc',label:'Claude Code',type:'cli'},{id:'gm-gc',label:'Gemini CLI',type:'cli'},
  {id:'gm-oc',label:'OpenCode',type:'cli'},{id:'gm-kilo',label:'Kilo Code',type:'cli'},
  {id:'gm-codex',label:'Codex',type:'cli'},{id:'gm-copilot-cli',label:'Copilot CLI',type:'cli'},
  {id:'gm-qwen',label:'Qwen Code',type:'cli'},{id:'gm-hermes',label:'Hermes Agent',type:'cli'},
  {id:'gm-vscode',label:'VS Code',type:'ide'},{id:'gm-cursor',label:'Cursor',type:'ide'},
  {id:'gm-zed',label:'Zed',type:'ide'},{id:'gm-jetbrains',label:'JetBrains',type:'ide'},
];
const GH_ICON='${GH_PATH}';
function NavBar(){return h('nav',{class:'border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-10'},h('div',{class:'max-w-5xl mx-auto px-4 py-3 flex items-center justify-between'},h('div',{class:'flex items-center gap-3'},h('a',{href:'https://anentrypoint.github.io/gm',class:'text-white font-bold text-lg hover:text-indigo-400 transition-colors'},'gm'),h('span',{class:'text-gray-500'},'/'),h('span',{class:'text-gray-300 font-medium'},BADGE_LABEL)),h('a',{href:GITHUB_URL,target:'_blank',rel:'noopener',class:'flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm'},h('svg',{viewBox:'0 0 16 16',class:'w-5 h-5 fill-current','aria-hidden':'true'},h('path',{d:GH_ICON})),'GitHub')));}
function Badge(label,color){return h('span',{class:'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold text-white',style:\`background-color:\${color}\`},label);}
function Hero(){return h('section',{class:'gradient-hero py-20 px-4'},h('div',{class:'max-w-5xl mx-auto text-center'},h('div',{class:'flex justify-center gap-2 mb-6'},Badge(PLATFORM_TYPE,PLATFORM_TYPE_COLOR),Badge('v'+VERSION,'#374151')),h('h1',{class:'text-4xl md:text-5xl font-bold text-white mb-4'},PLATFORM_NAME),h('p',{class:'text-lg text-gray-300 max-w-2xl mx-auto mb-8'},DESCRIPTION),h('a',{href:GITHUB_URL,target:'_blank',rel:'noopener',class:'inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-3 rounded-lg transition-colors'},'View on GitHub')));}
function FeatureCard(title,desc){return h('div',{class:'card-hover bg-gray-900 border border-gray-800 rounded-xl p-5'},h('h3',{class:'font-semibold text-white mb-2'},title),h('p',{class:'text-gray-400 text-sm leading-relaxed'},desc));}
function FeaturesSection(){return h('section',{class:'py-16 px-4'},h('div',{class:'max-w-5xl mx-auto'},h('h2',{class:'text-2xl font-bold text-white mb-8 text-center'},'Features'),h('div',{class:'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'},...FEATURES.map(f=>FeatureCard(f.title,f.desc)))));}
function InstallStep(step,index){return h('div',{class:'flex gap-4 items-start'},h('div',{class:'flex-shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white'},String(index+1)),h('div',{class:'flex-1'},h('p',{class:'text-gray-300 text-sm mb-1'},step.desc),step.cmd?h('pre',{class:'bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-sm text-green-400 overflow-x-auto mt-1'},step.cmd):null));}
function InstallSection(){if(!INSTALL_STEPS.length)return null;return h('section',{class:'py-16 px-4 bg-gray-900/50'},h('div',{class:'max-w-2xl mx-auto'},h('h2',{class:'text-2xl font-bold text-white mb-8 text-center'},'Installation'),h('div',{class:'space-y-6'},...INSTALL_STEPS.map((step,i)=>InstallStep(step,i)))));}
function PlatformLink(p){const isCurrent=p.id===CURRENT_PLATFORM;return h('a',{href:isCurrent?'#':\`https://anentrypoint.github.io/\${p.id}\`,class:\`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors \${isCurrent?'bg-indigo-600 text-white cursor-default':'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'}\`},p.label);}
const SM_PHASES=[{name:'PLAN',desc:'Write .prd with every unknown named before any work begins'},{name:'EXECUTE',desc:'Prove every hypothesis via witnessed execution, import real modules'},{name:'EMIT',desc:'Write files only after all tests pass — pre and post-emit gates'},{name:'VERIFY',desc:'End-to-end execution confirms all changes work in real context'},{name:'COMPLETE',desc:'.prd empty, git clean, all output pushed'}];
const HOOK_ITEMS=[{title:'Tool interception',desc:'exec:<lang> commands run code directly; forbidden tools redirected to code-search'},{title:'System injection',desc:'gm.md rules prepended to every system prompt'},{title:'Context injection',desc:'session-start injects codebase analysis and pending work reminder'},{title:'Completion gate',desc:'session end blocked until .prd is empty and git is clean'}];
function PhaseCard(phase,index,total){return h('div',{class:'card-hover bg-gray-900 border border-gray-800 rounded-xl p-4 flex-1 min-w-0'},h('div',{class:'flex items-center gap-2 mb-2'},h('span',{class:'text-indigo-400 font-bold text-sm font-mono'},phase.name),index<total-1?h('span',{class:'text-gray-600 text-xs'},'\u2192'):null),h('p',{class:'text-gray-400 text-xs leading-relaxed'},phase.desc));}
function StateMachineSection(){return h('section',{class:'py-16 px-4 bg-gray-900/40'},h('div',{class:'max-w-5xl mx-auto'},h('h2',{class:'text-2xl font-bold text-white mb-2 text-center'},'State Machine'),h('p',{class:'text-gray-400 text-sm text-center mb-8'},'Every task follows the same 5-phase cycle — no skipping, no shortcuts'),h('div',{class:'flex flex-col sm:flex-row gap-3'},...SM_PHASES.map((phase,i)=>PhaseCard(phase,i,SM_PHASES.length)))));}
function HookCard(item){return h('div',{class:'card-hover bg-gray-900 border border-gray-800 rounded-xl p-5'},h('h3',{class:'font-semibold text-white mb-2'},item.title),h('p',{class:'text-gray-400 text-sm leading-relaxed'},item.desc));}
function HooksSection(){return h('section',{class:'py-16 px-4'},h('div',{class:'max-w-5xl mx-auto'},h('h2',{class:'text-2xl font-bold text-white mb-2 text-center'},'What the Hooks Enforce'),h('p',{class:'text-gray-400 text-sm text-center mb-8'},'Lifecycle hooks wrap every interaction to keep the agent on rails'),h('div',{class:'grid grid-cols-1 sm:grid-cols-2 gap-4'},...HOOK_ITEMS.map(item=>HookCard(item)))));}
function AlsoAvailableSection(){const cli=ALL_PLATFORMS.filter(p=>p.type==='cli'),ide=ALL_PLATFORMS.filter(p=>p.type==='ide');return h('section',{class:'py-16 px-4 bg-gray-900/30'},h('div',{class:'max-w-5xl mx-auto'},h('h2',{class:'text-2xl font-bold text-white mb-8 text-center'},'Also Available For'),h('div',{class:'space-y-6'},h('div',null,h('p',{class:'text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3'},'CLI Tools'),h('div',{class:'flex flex-wrap gap-2'},...cli.map(p=>PlatformLink(p)))),h('div',null,h('p',{class:'text-xs font-semibold text-purple-400 uppercase tracking-wider mb-3'},'IDE Extensions'),h('div',{class:'flex flex-wrap gap-2'},...ide.map(p=>PlatformLink(p))))),h('div',{class:'mt-8 text-center'},h('a',{href:'https://anentrypoint.github.io/gm',class:'text-sm text-gray-400 hover:text-indigo-300 transition-colors'},'\u2190 Back to gm hub'))));}
function Footer(){return h('footer',{class:'border-t border-gray-800 py-8 px-4 text-center text-gray-500 text-sm'},h('p',null,'Generated by ',h('a',{href:'https://github.com/AnEntrypoint/gm',class:'text-indigo-400 hover:text-indigo-300'},'gm'),' \u2014 convention-driven multi-platform plugin generator'));}
applyDiff(document.body,[NavBar(),Hero(),FeaturesSection(),StateMachineSection(),HooksSection(),InstallSection(),AlsoAvailableSection(),Footer()]);
</script>
</body>
</html>`;
}

module.exports = { generateGitHubPage, getPlatformPageConfig };

import * as webjsx from "webjsx";
/**
 * Converts URL pattern to regex and extracts parameter names
 */
function parsePattern(pattern) {
    const paramNames = [];
    const regexString = pattern
        .replace(/\/$/, "") // Remove trailing slash
        .replace(/:[^/]+/g, (match) => {
        const paramName = match.slice(1);
        paramNames.push(paramName);
        return "([^/]+)";
    });
    return {
        regex: new RegExp(`^${regexString}$`),
        paramNames,
    };
}
/**
 * Extracts and decodes query parameters from URL
 */
function parseQueryString(search) {
    const params = new URLSearchParams(search);
    const result = {};
    params.forEach((value, key) => {
        result[decodeURIComponent(key)] = decodeURIComponent(value);
    });
    return result;
}
/**
 * Extracts parameters from URL based on pattern match
 */
function extractParams(pattern, match, paramNames) {
    const params = {};
    paramNames.forEach((name, index) => {
        const value = match[index + 1];
        if (value) {
            params[name] = decodeURIComponent(value);
        }
    });
    return params;
}
/**
 * Normalizes a URL path by:
 * 1. Removing multiple consecutive slashes
 * 2. Preserving trailing slash if present
 */
function normalizePath(path) {
    try {
        // Remove multiple consecutive slashes but preserve trailing
        const hasTrailingSlash = path.endsWith("/");
        const normalized = path.replace(/\/{2,}/g, "/").replace(/\/$/, "");
        return hasTrailingSlash ? normalized + "/" : normalized;
    }
    catch {
        return "";
    }
}
let rootElement;
/**
 * Initializes the router with the root container and render function
 */
export function initRouter(container, renderFn) {
    rootElement = {
        container,
        render: renderFn,
    };
    // Initial render
    const vdom = renderFn();
    if (vdom) {
        webjsx.applyDiff(container, vdom);
    }
    // Handle browser back/forward
    window.addEventListener("popstate", () => {
        if (rootElement) {
            const vdom = rootElement.render();
            if (vdom) {
                webjsx.applyDiff(rootElement.container, vdom);
            }
        }
    });
}
/**
 * Navigates to a new URL and triggers a re-render
 */
export function goto(path, query) {
    try {
        let url = path;
        if (query && Object.keys(query).length > 0) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined && value !== null) {
                    searchParams.append(encodeURIComponent(key), encodeURIComponent(value));
                }
            }
            url += `?${searchParams.toString()}`;
        }
        window.history.pushState({}, "", url);
        // Trigger re-render after navigation
        if (rootElement) {
            const vdom = rootElement.render();
            if (vdom) {
                webjsx.applyDiff(rootElement.container, vdom);
            }
        }
    }
    catch (error) {
        console.error("Navigation failed:", error);
    }
}
/**
 * Matches current URL against a pattern and renders component if matched
 */
export function match(pattern, render) {
    try {
        // Normalize paths - preserve trailing slash status
        const currentPath = normalizePath(window.location.pathname);
        const patternPath = normalizePath(pattern);
        const currentSearch = window.location.search;
        // Early return if trailing slash status doesn't match
        if (currentPath.endsWith("/") !== patternPath.endsWith("/")) {
            return undefined;
        }
        // Remove trailing slashes for regex matching
        const pathForMatching = currentPath.replace(/\/$/, "");
        const patternForMatching = patternPath.replace(/\/$/, "");
        // Parse pattern and try to match
        const { regex, paramNames } = parsePattern(patternForMatching);
        const match = pathForMatching.match(regex);
        if (!match) {
            return undefined;
        }
        // Extract and decode parameters
        const params = extractParams(pattern, match, paramNames);
        // Parse query string
        const query = parseQueryString(currentSearch);
        // Render component with extracted data
        try {
            return render(params, query);
        }
        catch (error) {
            console.error("Error rendering route:", error);
            return undefined;
        }
    }
    catch (error) {
        console.error("Error matching route:", error);
        return undefined;
    }
}
//# sourceMappingURL=index.js.map
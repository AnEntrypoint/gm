export function definesRenderSuspension(el) {
    return !!el.__webjsx_suspendRendering;
}
/**
 * Executes a callback with render suspension handling.
 * @param el Element that may have render suspension
 * @param callback Function to execute during suspension
 * @returns Result of the callback
 */
export function withRenderSuspension(el, callback) {
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
//# sourceMappingURL=renderSuspension.js.map
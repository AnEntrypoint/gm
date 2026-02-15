use zed_extension_api::*;
use std::sync::{Arc, Mutex};

pub struct GlootieExtension {
    is_active: bool,
    assistant_enabled: bool,
}

impl GlootieExtension {
    pub fn new() -> Self {
        GlootieExtension {
            is_active: false,
            assistant_enabled: false,
        }
    }

    pub fn activate(&mut self) {
        self.is_active = true;
    }

    pub fn deactivate(&mut self) {
        self.is_active = false;
    }

    pub fn is_active(&self) -> bool {
        self.is_active
    }

    pub fn is_assistant_enabled(&self) -> bool {
        self.assistant_enabled
    }

    pub fn toggle_assistant(&mut self) {
        self.assistant_enabled = !self.assistant_enabled;
    }
}

lazy_static::lazy_static! {
    static ref EXTENSION: Arc<Mutex<GlootieExtension>> = {
        Arc::new(Mutex::new(GlootieExtension::new()))
    };
}

#[no_mangle]
pub extern "C" fn init_extension() {
    let mut ext = EXTENSION.lock().unwrap();
    ext.activate();
}

#[no_mangle]
pub extern "C" fn get_extension_status() -> u8 {
    let ext = EXTENSION.lock().unwrap();
    if ext.is_active() { 1 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_creation() {
        let ext = GlootieExtension::new();
        assert!(!ext.is_active());
        assert!(!ext.is_assistant_enabled());
    }

    #[test]
    fn test_extension_activation() {
        let mut ext = GlootieExtension::new();
        ext.activate();
        assert!(ext.is_active());
    }

    #[test]
    fn test_extension_deactivation() {
        let mut ext = GlootieExtension::new();
        ext.activate();
        ext.deactivate();
        assert!(!ext.is_active());
    }

    #[test]
    fn test_toggle_assistant() {
        let mut ext = GlootieExtension::new();
        assert!(!ext.is_assistant_enabled());
        ext.toggle_assistant();
        assert!(ext.is_assistant_enabled());
        ext.toggle_assistant();
        assert!(!ext.is_assistant_enabled());
    }
}

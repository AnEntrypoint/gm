---
key: mem-60ea28d4c4ede4ac-529
ns: default
created: 1787320495211
updated: 1787320495211
---

gm-method: AGENTPLUG_EXTRA_CA_CERTS (falls back to SSL_CERT_FILE if unset) points at a PEM file of extra trust anchors layered on top of agentplug-runner's compiled-in webpki-roots set -- the escape hatch for a TLS-terminating proxy environment where the default rustls trust store cannot verify the proxy's own certificate. Every agentplug-host HTTP call (plugin download, runner self-update poll, the fetch verb) shares one ureq::Agent built with this store. Field-level detail lives in gm's own .gm/daemon-config-reference.md.

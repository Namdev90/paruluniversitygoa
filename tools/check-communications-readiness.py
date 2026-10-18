#!/usr/bin/env python3
"""Evaluate secret-free provider evidence. Does not read credentials or contact users."""
import json
import sys


def check_readiness(config: dict, evidence: dict) -> dict:
    config = config if isinstance(config, dict) else {}
    evidence = evidence if isinstance(evidence, dict) else {}
    blockers = []
    transports = {}
    for name in ("push", "voice"):
        provider = config.get(name)
        provider = provider if isinstance(provider, dict) else {}
        configured = provider.get("configured") is True
        resolved = provider.get("artifactResolved") is True
        transports[name] = {"configured": configured, "artifactResolved": resolved,
                            "deliveryVerified": evidence.get(name + "Delivery") is True}
        if not configured:
            blockers.append(name.upper() + "_NOT_CONFIGURED")
        if not resolved:
            blockers.append(name.upper() + "_ARTIFACT_NOT_RESOLVED")
    implementation = not blockers
    for name in ("push", "voice"):
        if not transports[name]["deliveryVerified"]:
            blockers.append(name.upper() + "_DELIVERY_NOT_VERIFIED")
    if evidence.get("revokedTokenRejected") is not True:
        blockers.append("VOICE_REVOCATION_NOT_VERIFIED")
    if evidence.get("workerHealthy") is not True:
        blockers.append("VOICE_WORKER_NOT_HEALTHY")
    return {"implementationReady": implementation, "releaseReady": not blockers,
            "push": transports["push"], "voice": transports["voice"], "blockers": blockers}


if __name__ == "__main__":
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        request = {}
    print(json.dumps(check_readiness(request.get("config", {}), request.get("evidence", {}))))

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
    # A heartbeat establishes only controller liveness. Active audio must stop
    # at a relay-owned deadline even after controller death or a late grant.
    for key, blocker in (
        ("leaseEnforced", "VOICE_MEDIA_LEASE_NOT_VERIFIED"),
        ("workerDeathVerified", "VOICE_CONTROLLER_DEATH_NOT_VERIFIED"),
        ("lateGrantRejected", "VOICE_LATE_GRANT_NOT_VERIFIED"),
    ):
        transports["voice"][key] = evidence.get(key) is True
        if evidence.get(key) is not True:
            blockers.append(blocker)
    voice = config.get("voice") if isinstance(config.get("voice"), dict) else {}
    mode = voice.get("revocationMode")
    if mode not in ("cloud-explicit-cutoff", "guarded-admission"):
        blockers.append("VOICE_REVOCATION_MODE_UNSAFE")
    if mode == "cloud-explicit-cutoff":
        ttl = voice.get("tokenTtlSeconds")
        if type(ttl) is not int or not 1 <= ttl <= 600:
            blockers.append("VOICE_TOKEN_TTL_UNSAFE")
    return {"implementationReady": implementation, "releaseReady": not blockers,
            "push": transports["push"], "voice": transports["voice"], "blockers": blockers}


if __name__ == "__main__":
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        request = {}
    print(json.dumps(check_readiness(request.get("config", {}), request.get("evidence", {}))))

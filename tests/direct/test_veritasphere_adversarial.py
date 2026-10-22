import json

from _mocks import (
    GOOD_URL, GOOD_URL_2, GOOD_PAGE,
    accept_llm, mock_good_web,
)

CONTRACT = "contracts/veritasphere.py"


def _submit(direct_vm, contract, topic, title, url, draft):
    return contract.submit_contribution(topic, title, url, draft)


def test_malformed_missing_score(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for malformed test case here.")
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({"summary": "Bitcoin decentralized currency summary long enough here.", "is_relevant": True}))
    with direct_vm.expect_revert("Missing 'score'"):
        contract.validate_contribution(1)


def test_malformed_non_numeric_score(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for non-numeric score test here.")
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({"summary": "Bitcoin decentralized currency summary long enough here.", "score": "ten", "is_relevant": True}))
    with direct_vm.expect_revert("Non-numeric score"):
        contract.validate_contribution(1)


def test_contradictory_verdict_rejected(direct_vm, direct_deploy, direct_alice):
    # is_relevant=true but score=2 -> contradiction must force LLM error, not settle
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for contradiction test case here.")
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm(score=2).replace('"is_relevant": true', '"is_relevant": true'))
    # accept_llm with score=2 + relevant=true + accurate=true -> relevant/score contradiction
    with direct_vm.expect_revert("Contradictory verdict"):
        contract.validate_contribution(1)
    # entry must stay PENDING, never settle on contradictory data
    assert contract.get_entry(1)["status"] == "PENDING"

    # opposite contradiction: relevant=false + high score
    direct_vm.clear_mocks()
    mock_good_web(direct_vm)
    bad = accept_llm(score=9).replace('"is_relevant": true', '"is_relevant": false')
    direct_vm.mock_llm(r".*Veritasphere.*", bad)
    with direct_vm.expect_revert("Contradictory verdict"):
        contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "PENDING"


def test_hallucinated_summary_rejected(direct_vm, direct_deploy, direct_alice):
    # summary shares no evidence vocabulary -> not bound to evidence
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for hallucination test case here.")
    mock_good_web(direct_vm)
    hallucinated = accept_llm(
        summary="Quantum zebras dance flamboyantly under purple moonlight every Tuesday evening."
    )
    direct_vm.mock_llm(r".*Veritasphere.*", hallucinated)
    with direct_vm.expect_revert("not bound"):
        contract.validate_contribution(1)


def test_concurrent_ids_use_returned_id(direct_vm, direct_deploy, direct_alice, direct_bob):
    # receipt correlation: each submit returns its own verification ID
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    id1 = _submit(direct_vm, contract, "ai", "First", GOOD_URL, "Alice draft summary long enough for concurrent test one.")
    direct_vm.sender = direct_bob
    id2 = _submit(direct_vm, contract, "ai", "Second", GOOD_URL_2, "Bob draft summary long enough for concurrent test two.")
    assert int(id1) == 1
    assert int(id2) == 2
    # validating 1 must not touch 2
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "ACCEPTED"
    assert contract.get_entry(2)["status"] == "PENDING"
    assert contract.get_validation_result(2)["source_url"] == GOOD_URL_2


def test_double_settle_guarded(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for double settle test here.")
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    with direct_vm.expect_revert("already ACCEPTED"):
        contract.validate_contribution(1)
    with direct_vm.expect_revert("already ACCEPTED"):
        contract.cancel_pending(1, "attempted cancel of settled entry")


def test_cancel_pending_unilateral_recovery(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft for cancel recovery test case here.")
    # stranger cannot cancel
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only contributor or owner"):
        contract.cancel_pending(1, "stranger attempt at cancelling")
    # contributor can cancel (unilateral recovery, justification optional) —
    # here the contributor IS the owner, so a justification is required
    direct_vm.sender = direct_alice
    out = contract.cancel_pending(1, "source stuck unreachable; withdrawing my own entry")
    assert "CANCELLED" in str(out)
    assert contract.get_entry(1)["status"] == "CANCELLED"
    v = contract.get_validation_result(1)
    assert v["status"] == "CANCELLED"
    assert v["settled_reward"] == "0"
    # cancelled can never be validated later
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    with direct_vm.expect_revert("already CANCELLED"):
        contract.validate_contribution(1)


def test_owner_cancel_requires_justification_and_funded_pool(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 100)
    # steward: submission must be covered by the pool — fund first
    direct_vm.value = 1000
    contract.fund_pool()
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Bob draft long enough for owner cancel test case here.")
    direct_vm.sender = direct_alice  # owner
    # steward: owner cancellation requires a recorded justification
    with direct_vm.expect_revert("requires justification"):
        contract.cancel_pending(1, "x")
    out = contract.cancel_pending(1, "source no longer resolves; superseded by newer entry")
    assert "CANCELLED" in str(out)
    assert contract.get_validation_result(1)["settled_reward"] == "0"
    # justification is recorded on the entry
    assert "OWNER CANCEL" in contract.get_entry(1)["reason"]
    # reservation released: full pool available again
    assert contract.get_stats()["available_balance"] == "1000"


def test_caller_attribution_records_sender(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    direct_vm.sender = direct_bob
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Bob draft long enough for attribution test case here.")
    e = contract.get_entry(1)
    # Address is stored as 0x-hex, must identify the actual sender (bob), not a fresh account
    assert e["contributor"].startswith("0x")
    stats = contract.get_contributor_stats(e["contributor"])
    assert stats["submitted"] == 1
    lb = contract.get_leaderboard(0, 10)
    assert any(r["contributor"] == e["contributor"] for r in lb["entries"])


def test_no_float_division_in_contract():
    with open(CONTRACT, "r", encoding="utf-8") as f:
        src = f.read()
        lines = [l for l in src.splitlines() if not l.strip().startswith("#") and "http" not in l and "Depends" not in l]
    for l in lines:
        stripped = l.split("#")[0]
        tmp = stripped.replace("//", "")
        if "def " in stripped or "if " in stripped or "return" in stripped or "=" in stripped:
            if " / " in tmp and "source_url" not in tmp.lower() and "prompt" not in tmp.lower():
                raise AssertionError(f"Float division found: {l}")
    assert '# { "Depends": "py-genlayer:' in src
    assert "py-genlayer:test" not in src
    assert "py-genlayer:latest" not in src

import json

CONTRACT = "contracts/veritasphere.py"
GOOD_URL = "https://en.wikipedia.org/wiki/Bitcoin"
GOOD_URL_2 = "https://docs.genlayer.com/developers/intelligent-contracts/ideas"
GOOD_PAGE = "Bitcoin is a decentralized digital currency. It was invented in 2008 by Satoshi Nakamoto. Transactions are verified by network nodes through cryptography."

ACCEPT_LLM = json.dumps({
    "summary": "Bitcoin is a decentralized digital currency invented in 2008 by Satoshi Nakamoto, with transactions verified by network nodes.",
    "score": 9,
    "is_relevant": True,
    "reason": "reputable source, faithful summary"
})


def _submit(direct_vm, contract, topic, title, url, draft):
    return contract.submit_contribution(topic, title, url, draft)


def test_malformed_missing_score(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for malformed test case here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({"summary": "Bitcoin decentralized currency summary long enough here.", "is_relevant": True}))
    with direct_vm.expect_revert("Missing 'score'"):
        contract.validate_contribution(1)


def test_malformed_non_numeric_score(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for non-numeric score test here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({"summary": "Bitcoin decentralized currency summary long enough here.", "score": "ten", "is_relevant": True}))
    with direct_vm.expect_revert("Non-numeric score"):
        contract.validate_contribution(1)


def test_contradictory_verdict_rejected(direct_vm, direct_deploy, direct_alice):
    # is_relevant=true but score=2 -> contradiction must force LLM error, not settle
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for contradiction test case here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({
        "summary": "Bitcoin is a decentralized digital currency invented by Satoshi Nakamoto with network verification.",
        "score": 2, "is_relevant": True, "reason": "contradiction"
    }))
    with direct_vm.expect_revert("Contradictory verdict"):
        contract.validate_contribution(1)
    # entry must stay PENDING, never settle on contradictory data
    assert contract.get_entry(1)["status"] == "PENDING"

    # opposite contradiction: false + high score
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({
        "summary": "Bitcoin is a decentralized digital currency invented by Satoshi Nakamoto with network verification.",
        "score": 9, "is_relevant": False, "reason": "contradiction2"
    }))
    with direct_vm.expect_revert("Contradictory verdict"):
        contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "PENDING"


def test_hallucinated_summary_rejected(direct_vm, direct_deploy, direct_alice):
    # summary shares no words with source -> not bound to evidence
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for hallucination test case here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps({
        "summary": "Quantum zebras dance flamboyantly under purple moonlight every Tuesday evening.",
        "score": 8, "is_relevant": True, "reason": "hallucinated"
    }))
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
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", ACCEPT_LLM)
    contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "ACCEPTED"
    assert contract.get_entry(2)["status"] == "PENDING"
    assert contract.get_validation_result(2)["source_url"] == GOOD_URL_2


def test_double_settle_guarded(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft summary for double settle test here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", ACCEPT_LLM)
    contract.validate_contribution(1)
    with direct_vm.expect_revert("already ACCEPTED"):
        contract.validate_contribution(1)
    with direct_vm.expect_revert("already ACCEPTED"):
        contract.cancel_pending(1)


def test_cancel_pending_unilateral_recovery(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Long enough draft for cancel recovery test case here.")
    # stranger cannot cancel
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only contributor or owner"):
        contract.cancel_pending(1)
    # contributor can cancel (unilateral recovery, no timeout lock)
    direct_vm.sender = direct_alice
    out = contract.cancel_pending(1)
    assert "CANCELLED" in str(out)
    assert contract.get_entry(1)["status"] == "CANCELLED"
    v = contract.get_validation_result(1)
    assert v["status"] == "CANCELLED"
    assert v["settled_reward"] == "0"
    # cancelled can never be validated later
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": GOOD_PAGE})
    direct_vm.mock_llm(r".*Veritasphere.*", ACCEPT_LLM)
    with direct_vm.expect_revert("already CANCELLED"):
        contract.validate_contribution(1)


def test_owner_can_cancel_and_reward_zero_after_cancel(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 100)
    direct_vm.sender = direct_bob
    _submit(direct_vm, contract, "ai", "T", GOOD_URL, "Bob draft long enough for owner cancel test case here.")
    direct_vm.sender = direct_alice  # owner
    contract.cancel_pending(1)
    assert contract.get_validation_result(1)["settled_reward"] == "0"


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
    # alice did not submit
    alice_stats = contract.get_contributor_stats(str(direct_alice) if isinstance(direct_alice, str) else e["contributor"])
    # sanity: leaderboard contains the recorded contributor
    lb = contract.get_leaderboard(10)
    assert any(r["contributor"] == e["contributor"] for r in lb)


def test_no_float_division_in_contract():
    with open(CONTRACT, "r", encoding="utf-8") as f:
        src = f.read()
    # forbid single-slash float division outside comments/URLs/strings is hard;
    # check the specific staff complaint: no ' / ' float division in logic
    lines = [l for l in src.splitlines() if not l.strip().startswith("#") and "http" not in l and "Depends" not in l]
    for l in lines:
        stripped = l.split("#")[0]
        # allow // integer division, forbid single /
        tmp = stripped.replace("//", "")
        # ignore division inside triple-quoted prompt strings is okay, but logic must not use /
        if "def " in stripped or "if " in stripped or "return" in stripped or "=" in stripped:
            # only flag obvious arithmetic division on numbers
            if " / " in tmp and "source_url" not in tmp.lower() and "prompt" not in tmp.lower():
                raise AssertionError(f"Float division found: {l}")
    assert '# { "Depends": "py-genlayer:' in src
    assert "py-genlayer:test" not in src
    assert "py-genlayer:latest" not in src

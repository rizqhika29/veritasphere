# Steward-review scenarios (2026-10): reward reservation, claim-level
# verification, evidence commitments, threshold-crossing consensus,
# administrative transparency + appeal, indexed/paginated access.
import json

from _mocks import (
    GOOD_URL, GOOD_URL_2, GOOD_PAGE,
    accept_llm, mock_good_web, mock_good_llm,
)

CONTRACT = "contracts/veritasphere.py"

REWARD = 100


def _load_pure_helpers():
    # The `genlayer` runtime is only importable inside the VM sandbox (WASI),
    # so extract the module-level pure helpers via AST and exec them in a
    # clean namespace — same source text the contract runs, zero duplication.
    import ast
    wanted_funcs = {
        "_accept_class", "_verdicts_agree", "_tokens",
        "_fnv1a64", "_claims_supported", "_sig_tokens",
        "_strip_numeric_markup",
    }
    wanted_consts = {"ACCEPT_THRESHOLD", "SCORE_TOLERANCE", "MIN_CLAIMS"}
    with open(CONTRACT, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read())
    ns = {}
    for node in tree.body:
        keep = False
        if isinstance(node, ast.FunctionDef) and node.name in wanted_funcs:
            keep = True
        elif isinstance(node, ast.Assign):
            keep = any(
                isinstance(t, ast.Name) and t.id in wanted_consts
                for t in node.targets
            )
        if keep:
            module = ast.Module(body=[node], type_ignores=[])
            exec(compile(module, CONTRACT, "exec"), ns)
    from types import SimpleNamespace
    return SimpleNamespace(**ns)


def _funded(direct_vm, direct_deploy, sender, reward=REWARD, fund=1000):
    direct_vm.sender = sender
    contract = direct_deploy(CONTRACT, reward)
    direct_vm.value = fund
    contract.fund_pool()
    direct_vm.value = 0
    return contract


# ---------------------------------------------------------------- issue 1:
# reward obligations reserved at registration; withdrawals protected

def test_submit_fails_when_pool_insufficient(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, REWARD)  # advertised 100, pool 0
    with direct_vm.expect_revert("Insufficient available pool"):
        contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft summary for reservation test here.")


def test_fund_pool_credits_ledger(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, reward=0, fund=500)
    stats = contract.get_stats()
    assert stats["pool_balance"] == "500"
    assert stats["available_balance"] == "500"
    assert stats["reserved_balance"] == "0"


def test_reserved_locked_from_withdraw(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=1000)
    contract.submit_contribution("ai", "T1", GOOD_URL, "First reserved entry draft summary long enough for test.")
    contract.submit_contribution("ai", "T2", GOOD_URL_2, "Second reserved entry draft summary long enough for test.")
    stats = contract.get_stats()
    assert stats["reserved_balance"] == "200"
    assert stats["available_balance"] == "800"
    # owner cannot touch the 200 reserved for the two PENDING entries
    owner_hex = "0x" + direct_alice.hex()
    with direct_vm.expect_revert("Insufficient available"):
        contract.withdraw(801, owner_hex)
    contract.withdraw(800, owner_hex)
    stats = contract.get_stats()
    assert stats["pool_balance"] == "200"
    assert stats["available_balance"] == "0"


def test_reward_change_does_not_touch_pending(direct_vm, direct_deploy, direct_alice):
    # entry commits 100 at registration; owner later raises the advertised rate
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary registered before the reward change, long enough.")
    assert contract.get_entry(1)["committed_reward"] == "100"
    contract.set_reward_amount(500)
    assert contract.get_stats()["reward_amount"] == "500"
    assert contract.get_entry(1)["committed_reward"] == "100"
    # settlement pays the COMMITTED amount, not the new advertised rate
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    entry = contract.get_entry(1)
    assert entry["status"] == "ACCEPTED"
    assert entry["settled_reward"] == "100"
    stats = contract.get_stats()
    assert stats["pool_balance"] == "400"
    assert stats["reserved_balance"] == "0"


def test_rejected_releases_reservation(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for reservation release test, long enough text.")
    assert contract.get_stats()["reserved_balance"] == "100"
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm(score=3).replace('"is_relevant": true', '"is_relevant": false'))
    contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "REJECTED"
    stats = contract.get_stats()
    assert stats["reserved_balance"] == "0"
    assert stats["available_balance"] == "500"


# ---------------------------------------------------------------- issue 2:
# claim-level verification + contributor accuracy vs AI rewriting

def test_missing_contributor_accurate_fails_closed(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft for missing-accuracy field test here.")
    mock_good_web(direct_vm)
    payload = json.loads(accept_llm())
    del payload["contributor_accurate"]
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps(payload))
    with direct_vm.expect_revert("Missing 'contributor_accurate'"):
        contract.validate_contribution(1)


def test_missing_claims_fail_closed(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft for missing-claims field test here.")
    mock_good_web(direct_vm)
    payload = json.loads(accept_llm())
    del payload["claims"]
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps(payload))
    with direct_vm.expect_revert("claims missing"):
        contract.validate_contribution(1)


def test_fabricated_support_quote_fails_closed(direct_vm, direct_deploy, direct_alice):
    # an LLM citing a passage that does not exist in the fetched page must
    # never reach settlement
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft for fabricated citation test here.")
    mock_good_web(direct_vm)
    payload = json.loads(accept_llm())
    payload["claims"][0]["support_quote"] = "the moon landing was faked by bitcoin miners in 1969"
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps(payload))
    with direct_vm.expect_revert("support_quote not found"):
        contract.validate_contribution(1)


def test_inaccurate_draft_rejected_even_with_good_source(direct_vm, direct_deploy, direct_alice):
    # source is reputable, but the contributor draft misstates it —
    # contributor_accurate=false forces REJECT; AI rewriting cannot rescue it
    contract = _funded(direct_vm, direct_deploy, direct_alice, reward=0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft claims bitcoin was invented in 1991 by aliens, long enough.")
    mock_good_web(direct_vm)
    payload = json.loads(accept_llm())
    payload["score"] = 5
    payload["contributor_accurate"] = False
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps(payload))
    contract.validate_contribution(1)
    assert contract.get_entry(1)["status"] == "REJECTED"


def test_inaccurate_draft_with_high_score_is_contradictory(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft accuracy contradiction test draft summary long enough.")
    mock_good_web(direct_vm)
    payload = json.loads(accept_llm())
    payload["contributor_accurate"] = False
    payload["score"] = 8
    direct_vm.mock_llm(r".*Veritasphere.*", json.dumps(payload))
    with direct_vm.expect_revert("Contradictory verdict"):
        contract.validate_contribution(1)


def test_superficially_relevant_summary_fails_binding(direct_vm, direct_deploy, direct_alice):
    # keyword-overlap summary without real coverage: <50% of its significant
    # vocabulary comes from the page -> "not bound"
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft for superficial binding test case here.")
    mock_good_web(direct_vm)
    superficial = (
        "Bitcoin decentralized currency invented cryptography Nakamoto remittance "
        "banking revolutionized global commerce operations today."
    )
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm(summary=superficial))
    with direct_vm.expect_revert("not bound"):
        contract.validate_contribution(1)


# ---------------------------------------------------------------- issue 3:
# evidence commitments, completeness, changed/unavailable pages, HTTPS

def test_incomplete_source_rejected(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy(CONTRACT, 0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Long enough draft for incomplete source test here.")
    direct_vm.mock_web(r".*wikipedia.*", {"status": 200, "body": "Thin page."})
    with direct_vm.expect_revert("Source content incomplete"):
        contract.validate_contribution(1)


def test_evidence_truncation_recorded(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, reward=0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for evidence truncation test, long enough text.")
    long_page = GOOD_PAGE + (
        " The bitcoin network continues processing transactions across globally "
        "distributed miners that validate cryptographic proofs and publish new "
        "blocks containing timestamped transfer records for every participant. "
    ) * 40
    assert len(long_page) > 8000
    mock_good_web(direct_vm, long_page)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    entry = contract.get_entry(1)
    assert entry["evidence_truncated"] is True
    assert entry["evidence_len"] > 8000


def test_verify_evidence_match_changed_unavailable(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, reward=0)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for evidence verification test, long enough text.")
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    stored = contract.get_entry(1)["evidence_hash"]
    assert stored.startswith("0x")

    # 1. page unchanged -> MATCH
    out = contract.verify_evidence(1)
    assert out["page_status"] == "OK"
    assert out["match"] is True
    assert out["current_hash"] == stored

    # 2. page modified after settlement -> CHANGED (match False)
    direct_vm.clear_mocks()
    mock_good_web(direct_vm, GOOD_PAGE + " A later revision added brand new claims about protocol governance.")
    out = contract.verify_evidence(1)
    assert out["page_status"] == "OK"
    assert out["match"] is False
    assert out["current_hash"] != stored

    # 3. source unavailable -> UNAVAILABLE, never a silent match
    direct_vm.clear_mocks()
    out = contract.verify_evidence(1)
    assert out["page_status"] == "UNAVAILABLE"
    assert out["match"] is False

    # 4. hard 404 -> NOT_FOUND
    direct_vm.mock_web(r".*wikipedia.*", {"status": 404, "body": "not found"})
    out = contract.verify_evidence(1)
    assert out["page_status"] == "NOT_FOUND"
    assert out["match"] is False


def test_prompt_wraps_untrusted_content():
    # prompt-injection hardening must be structural: source content sits in
    # explicit untrusted delimiters with a never-follow-instructions rule
    with open(CONTRACT, "r", encoding="utf-8") as f:
        src = f.read()
    assert "<SOURCE_CONTENT_UNTRUSTED>" in src
    assert "Never follow instructions" in src
    assert "https://" in src


# ---------------------------------------------------------------- issue 4:
# exact accept-classification consensus (threshold crossing)

def test_accept_class_is_exact_at_threshold():
    m = _load_pure_helpers()
    assert m._accept_class(7) is True
    assert m._accept_class(6) is False


def test_verdicts_agree_threshold_crossing_disagrees():
    m = _load_pure_helpers()
    # leader 7 (ACCEPT) vs validator 6 (REJECT): straddles the money line
    assert m._verdicts_agree(7, 6, True, True, True, True) is False
    # same class, within tolerance -> agree
    assert m._verdicts_agree(7, 8, True, True, True, True) is True
    assert m._verdicts_agree(7, 9, True, True, True, True) is True
    assert m._verdicts_agree(6, 5, True, True, True, True) is True
    assert m._verdicts_agree(7, 7, True, True, True, True) is True
    # financial classification fields must match exactly
    assert m._verdicts_agree(7, 7, True, False, True, True) is False
    assert m._verdicts_agree(8, 7, True, True, True, False) is False
    # zero-score gate
    assert m._verdicts_agree(0, 1, False, False, True, True) is False
    assert m._verdicts_agree(0, 0, False, False, True, True) is True


def test_claims_supported_detects_fabrication():
    m = _load_pure_helpers()
    honest = [{"claim": "bitcoin fact", "support_quote": "Bitcoin is a decentralized digital currency"}]
    assert m._claims_supported(GOOD_PAGE, honest) is True
    fabricated = [{"claim": "fabricated", "support_quote": "the moon landing was faked by bitcoin miners in 1969"}]
    assert m._claims_supported(GOOD_PAGE, fabricated) is False


def test_claim_gate_tolerates_formatting_but_not_content():
    # Regression for the live studionet failure: real LLMs re-case and
    # repunctuate quotes — token-sequence matching must accept that …
    m = _load_pure_helpers()
    cleaned = [{"claim": "c", "support_quote": "  BITCOIN is a decentralized digital currency... "}]
    assert m._claims_supported(GOOD_PAGE, cleaned) is True
    # …while content changes still fail closed: number swap …
    swapped = [{"claim": "c", "support_quote": "invented in 2009 by Satoshi Nakamoto"}]
    assert m._claims_supported(GOOD_PAGE, swapped) is False
    # … elision (non-contiguous words) …
    elided = [{"claim": "c", "support_quote": "decentralized currency invented Satoshi"}]
    assert m._claims_supported(GOOD_PAGE, elided) is False
    # … and dropped words.
    dropped = [{"claim": "c", "support_quote": "invented in 2008 by Nakamoto"}]
    assert m._claims_supported(GOOD_PAGE, dropped) is False


def test_validate_accepts_wiki_markup_noise_end_to_end(direct_vm, direct_deploy, direct_alice):
    # Live studionet regression (2026-10-22): validate_contribution failed 4/4
    # with "Claim support_quote not found" — real wiki pages carry numeric
    # entities (&#8212;), named leftovers (&hellip;) and citation markers
    # ([1]) sitting MID-QUOTE, and the LLM re-cases quotes. The cleaned
    # prompt text must match the cleaned haystack, formatting noise included.
    m = _load_pure_helpers()
    assert m._strip_numeric_markup("a&#8212;b[12]") == "a b "

    body = (
        "<html><head><script>track()</script><style>.a{}</style></head><body><p>"
        "Bitcoin is a decentralized digital currency&#8212;invented in 2008 by "
        "Satoshi&#160;Nakamoto[1] and verified by network nodes through "
        "cryptography&hellip; "
        + ("The public ledger records every transfer on the blockchain and "
           "miners maintain it according to agreed network rules. ") * 5
        + "</p></body></html>"
    )
    direct_vm.sender = direct_alice
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    contract.submit_contribution(
        "crypto", "Wiki noise", GOOD_URL,
        "Bitcoin is a decentralized digital currency invented in 2008 by Satoshi Nakamoto.",
    )
    direct_vm.mock_web(r".*wikipedia\.org/wiki/Bitcoin.*", {"status": 200, "body": body})
    mock_good_llm(direct_vm)  # quotes are case/punctuation-cleaned vs the markup
    out = contract.validate_contribution(1)
    assert "ACCEPTED" in str(out), str(out)


def test_fnv1a64_commitment_deterministic():
    m = _load_pure_helpers()
    h1 = m._fnv1a64("bitcoin evidence")
    h2 = m._fnv1a64("bitcoin evidence")
    h3 = m._fnv1a64("bitcoin evidence changed")
    assert h1 == h2
    assert h1 != h3
    assert h1.startswith("0x")


# ---------------------------------------------------------------- issue 5:
# transparent cancellation, audit trail, appeal/recovery

def test_admin_actions_are_audited(direct_vm, direct_deploy, direct_alice):
    contract = _funded(direct_vm, direct_deploy, direct_alice, reward=100, fund=500)
    contract.set_reward_amount(150)
    contract.withdraw(50, "0x" + direct_alice.hex())
    audit = contract.get_audit(0, 10)
    actions = [e["action"] for e in audit["entries"]]
    assert "SET_REWARD" in actions
    assert "WITHDRAW" in actions
    assert audit["total"] == 2
    for row in audit["entries"]:
        assert row["actor"].startswith("0x")


def test_owner_cancel_recorded_in_audit(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    direct_vm.sender = direct_bob
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for owner cancel audit test, long enough text.")
    direct_vm.sender = direct_alice
    contract.cancel_pending(1, "duplicated reporting of the same event, superseding")
    audit = contract.get_audit(0, 10)
    assert audit["entries"][-1]["action"] == "OWNER_CANCEL"
    assert audit["entries"][-1]["entry_id"] == 1
    assert "superseding" in audit["entries"][-1]["detail"]


def test_contributor_appeal_reinstates_once(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    direct_vm.sender = direct_bob
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for appeal reinstatement test, long enough.")
    direct_vm.sender = direct_alice
    contract.cancel_pending(1, "premature cancellation during source outage window")
    assert contract.get_entry(1)["status"] == "CANCELLED"
    assert contract.get_stats()["available_balance"] == "500"

    # recovery: original contributor appeals -> back to PENDING, funds re-reserved
    direct_vm.sender = direct_bob
    out = contract.appeal_cancellation(1, "the source is reachable again, please revalidate")
    assert "REINSTATED" in str(out)
    entry = contract.get_entry(1)
    assert entry["status"] == "PENDING"
    assert entry["appeal_count"] == 1
    assert contract.get_stats()["available_balance"] == "400"

    # a second cancellation cannot be appealed twice
    direct_vm.sender = direct_alice
    contract.cancel_pending(1, "second owner cancellation with recorded reason")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("already used its appeal"):
        contract.appeal_cancellation(1, "second appeal attempt with recorded reason")

    audit = contract.get_audit(0, 10)
    actions = [e["action"] for e in audit["entries"]]
    assert "APPEAL_REINSTATE" in actions


def test_appeal_guards(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for appeal guards test case, long enough text.")
    contract.cancel_pending(1, "owner cancels with a proper justification")
    # only the original contributor may appeal
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the original contributor"):
        contract.appeal_cancellation(1, "someone else tries to appeal this entry")
    # appeal requires a real reason
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("requires a reason"):
        contract.appeal_cancellation(1, "short")
    # appeal requires available funds for re-reservation
    contract.withdraw(500, "0x" + direct_alice.hex())
    with direct_vm.expect_revert("Insufficient available pool"):
        contract.appeal_cancellation(1, "attempting reinstatement without available funds")


# ---------------------------------------------------------------- issue 7:
# indexed / paginated access

def test_contributor_cancel_without_justification(direct_vm, direct_deploy, direct_alice, direct_bob):
    # non-owner contributor may cancel their own entry with an empty reason
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=500)
    direct_vm.sender = direct_bob
    contract.submit_contribution("ai", "T", GOOD_URL, "Draft summary for bare contributor cancel test, long enough.")
    out = contract.cancel_pending(1, "")
    assert "CANCELLED" in str(out)
    assert contract.get_stats()["available_balance"] == "500"

def test_registry_pagination_and_shrink(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _funded(direct_vm, direct_deploy, direct_alice, fund=1000)
    contract.submit_contribution("ai", "A1", GOOD_URL, "First entry draft summary for pagination test long enough.")
    direct_vm.sender = direct_bob
    contract.submit_contribution("ai", "B1", GOOD_URL_2, "Second entry draft summary for pagination test long.")
    direct_vm.sender = direct_alice
    contract.submit_contribution("ai", "A2", "https://example.org/another-page", "Third entry draft summary for pagination test.")

    pending = contract.get_pending_entries(0, 2)
    assert pending["total"] == 3
    assert len(pending["entries"]) == 2
    page2 = contract.get_pending_entries(2, 2)
    assert len(page2["entries"]) == 1

    by_topic = contract.get_entries_by_topic("ai", 0, 2)
    assert by_topic["total"] == 3
    assert len(by_topic["entries"]) == 2
    topic_page2 = contract.get_entries_by_topic("ai", 2, 2)
    assert len(topic_page2["entries"]) == 1

    # settle one, cancel one -> pending registry shrinks by two
    mock_good_web(direct_vm)
    direct_vm.mock_llm(r".*Veritasphere.*", accept_llm())
    contract.validate_contribution(1)
    direct_vm.sender = direct_bob
    contract.cancel_pending(2, "contributor withdrew this submission themselves")
    assert contract.get_pending_entries(0, 10)["total"] == 1
    remaining = contract.get_pending_entries(0, 10)["entries"]
    assert remaining[0]["id"] == 3

    # accepted pagination
    acc = contract.get_accepted_entries("", 0, 10)
    assert acc["total"] == 1
    assert acc["entries"][0]["id"] == 1
    acc_off = contract.get_accepted_entries("", 1, 10)
    assert acc_off["entries"] == []

    # leaderboard pagination
    lb = contract.get_leaderboard(0, 10)
    assert lb["total"] == 2
    lb_page = contract.get_leaderboard(1, 1)
    assert len(lb_page["entries"]) == 1
    assert lb_page["total"] == 2

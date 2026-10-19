# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json


ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

ACCEPT_THRESHOLD = 7
SCORE_TOLERANCE = 2


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Entry:
    contributor: Address
    topic: str
    title: str
    source_url: str
    summary: str
    score: u32
    status: str  # PENDING / ACCEPTED / REJECTED / CANCELLED
    reason: str
    # Appended for staff-feedback hardening (layout: append-only).
    # evidence_snippet preserves the exact source text used for this revision.
    # settled_reward binds the exact payout decided at settlement (0 if rejected).
    evidence_snippet: str
    settled_reward: u256


def _parse_score(analysis: dict) -> u32:
    if not isinstance(analysis, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-dict LLM response: {type(analysis)}")
    raw = analysis.get("score")
    if raw is None:
        for alt in ("rating", "points", "value", "result"):
            if alt in analysis:
                raw = analysis[alt]
                break
    if raw is None:
        raise gl.vm.UserError(f"{ERROR_LLM} Missing 'score'. Keys: {list(analysis.keys())}")
    try:
        v = int(round(float(str(raw).strip())))
    except (ValueError, TypeError, AttributeError):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-numeric score: {raw}")
    if v < 0:
        v = 0
    if v > 10:
        v = 10
    return u32(v)


def _parse_summary(analysis: dict) -> str:
    if not isinstance(analysis, dict):
        return ""
    for key in ("summary", "ringkasan", "text"):
        val = analysis.get(key)
        if isinstance(val, str) and len(val.strip()) > 0:
            return val.strip()[:2000]
    return ""


def _parse_relevant(analysis: dict) -> bool:
    if not isinstance(analysis, dict):
        return False
    for key in ("is_relevant", "relevant", "accept", "approved"):
        val = analysis.get(key)
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            low = val.strip().lower()
            if low in ("true", "yes", "y", "1"):
                return True
            if low in ("false", "no", "n", "0"):
                return False
    # fallback: score-based (integer threshold, no float division)
    try:
        return int(float(str(analysis.get("score", 0)))) >= ACCEPT_THRESHOLD
    except (ValueError, TypeError):
        return False


def _check_contradiction(score: int, relevant: bool) -> None:
    # Reject malformed / contradictory LLM verdicts before they reach settlement.
    # is_relevant=true with very low score, or false with high score, means the
    # model contradicted itself — force rotation instead of settling bad data.
    if relevant and int(score) <= 3:
        raise gl.vm.UserError(f"{ERROR_LLM} Contradictory verdict: relevant=true but score={score}")
    if (not relevant) and int(score) >= ACCEPT_THRESHOLD:
        raise gl.vm.UserError(f"{ERROR_LLM} Contradictory verdict: relevant=false but score={score}")


def _html_to_text(raw: str) -> str:
    # Deterministic HTML → visible text (no re module; pure string ops).
    # The evidence gate and LLM prompt must see real content, not <head>/scripts.
    s = raw
    low = s.lower()
    for tag in ("script", "style", "noscript", "svg"):
        open_t = "<" + tag
        close_t = "</" + tag
        while True:
            i = low.find(open_t)
            if i < 0:
                break
            j = low.find(close_t, i)
            j = len(s) if j < 0 else j + len(close_t)
            s = s[:i] + " " + s[j:]
            low = s.lower()
    out: list = []
    in_tag = False
    for ch in s:
        if ch == "<":
            in_tag = True
            continue
        if ch == ">":
            in_tag = False
            out.append(" ")
            continue
        if not in_tag:
            out.append(ch)
    text = "".join(out)
    for ent, rep in (
        ("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
        ("&quot;", '"'), ("&#39;", "'"), ("&apos;", "'"), ("&mdash;", "-"),
    ):
        text = text.replace(ent, rep)
    return " ".join(text.split())


def _sig_tokens(text: str) -> set:
    # Significant-word tokens, normalized identically on both sides of any
    # comparison (hyphens/slashes become separators — "proof-of-work" matches).
    stop = {"this", "that", "with", "from", "have", "were", "what", "when", "about", "into"}
    tokens: set = set()
    for w in (
        text.lower()
        .replace(",", " ").replace(".", " ").replace("-", " ")
        .replace("/", " ").replace("_", " ").split()
    ):
        c = "".join(ch for ch in w if ch.isalnum())
        if len(c) > 4 and c not in stop:
            tokens.add(c)
    return tokens


def _summary_bound_to_evidence(summary: str, page_text: str) -> bool:
    # Deterministic faithfulness gate: leader summary must share evidence.
    # Requires >=2 significant tokens (>4 chars, normalized on BOTH sides)
    # from the fetched source to appear in the summary. Prevents hallucinated
    # summaries passing on length alone.
    if len(summary.strip()) < 20:
        return False
    page_tokens = _sig_tokens(page_text)
    if not page_tokens:
        return False
    return len(page_tokens & _sig_tokens(summary)) >= 2


def _handle_leader_error(leaders_res, leader_fn) -> bool:
    # Deterministic error consensus: when the leader's execution raised, a
    # validator AGREES iff it reproduces the exact same error. This covers all
    # error classes ([EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]) — previously
    # LLM_ERROR never reached agreement, so every flaky LLM verdict ended
    # MAJORITY_DISAGREE / UNDETERMINED instead of a retryable settled error.
    leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
    try:
        leader_fn()
        # Leader failed but validator succeeded → cannot verify → disagree.
        return False
    except gl.vm.UserError as e:
        validator_msg = e.message if hasattr(e, "message") else str(e)
        if validator_msg == leader_msg:
            return True
        # transient fetch failures rarely stringify identically — both-side
        # [TRANSIENT] still counts as agreement (source down for everyone).
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            return True
        return False
    except Exception:
        return False


class Veritasphere(gl.Contract):
    owner: Address
    next_id: u32
    reward_amount: u256
    entries: TreeMap[u32, Entry]
    topics_list: DynArray[str]
    submitted_count: TreeMap[Address, u32]
    accepted_count: TreeMap[Address, u32]
    contributors_list: DynArray[Address]

    def __init__(self, reward_amount: u256):
        self.owner = gl.message.sender_address
        self.next_id = u32(1)
        self.reward_amount = reward_amount

    # ---------- helpers (deterministic) ----------

    def _normalize_topic(self, topic: str) -> str:
        return topic.strip().lower()

    def _as_address(self, v) -> Address:
        # 40-hex args arrive from the ABI as a native Address even when the
        # parameter is declared str (CLI/contract callers send address type).
        # Address(Address) raises "cannot convert 'Address' object to bytes",
        # so wrap ONLY str/bytes inputs and pass Address through untouched.
        return v if isinstance(v, Address) else Address(str(v))

    def _require_entry(self, entry_id: u32) -> Entry:
        if entry_id not in self.entries:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Entry {entry_id} not found")
        return self.entries[entry_id]

    # ---------- core flow ----------

    @gl.public.write
    def submit_contribution(self, topic: str, title: str, source_url: str, summary: str) -> u32:
        if len(topic.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Topic required")
        if len(title.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Title required")
        if len(source_url.strip()) == 0:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} source_url required")
        if not (source_url.startswith("http://") or source_url.startswith("https://")):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} source_url must start with http(s)://")
        if len(summary.strip()) < 20:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Provide initial summary min 20 chars")

        norm_topic = self._normalize_topic(topic)

        # duplicate source_url check (O(n), fine for MVP)
        for eid in range(u32(1), self.next_id):
            eid = u32(eid)
            if eid in self.entries:
                if self.entries[eid].source_url == source_url.strip():
                    raise gl.vm.UserError(f"{ERROR_EXPECTED} source_url already submitted as entry {eid}")

        entry_id = self.next_id
        sender = gl.message.sender_address
        self.entries[entry_id] = Entry(
            contributor=sender,
            topic=norm_topic,
            title=title.strip()[:300],
            source_url=source_url.strip()[:1000],
            summary=summary.strip()[:2000],
            score=u32(0),
            status="PENDING",
            reason="",
            evidence_snippet="",
            settled_reward=u256(0),
        )
        self.next_id = u32(int(self.next_id) + 1)

        if norm_topic not in self.topics_list:
            self.topics_list.append(norm_topic)

        current = self.submitted_count.get(sender, u32(0))
        self.submitted_count[sender] = u32(int(current) + 1)
        if sender not in self.contributors_list:
            self.contributors_list.append(sender)
        return entry_id

    @gl.public.write
    def validate_contribution(self, entry_id: u32) -> str:
        storage_entry = self._require_entry(u32(entry_id))
        # One-time settlement guard: only PENDING can transition.
        # ACCEPTED/REJECTED/CANCELLED are terminal and can never be paid/refunded again.
        if storage_entry.status != "PENDING":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Entry {entry_id} already {storage_entry.status}")

        # copy to memory — storage cannot be read inside nondet blocks.
        # Adjudication inputs are bound to these stored terms, not to caller supply:
        # validate() takes only entry_id, so arbitrary callers cannot inject evidence.
        mem_entry = gl.storage.copy_to_memory(storage_entry)
        bound_id: int = int(entry_id)
        source_url: str = str(mem_entry.source_url)
        topic: str = str(mem_entry.topic)
        title: str = str(mem_entry.title)
        user_summary: str = str(mem_entry.summary)
        # u256 primitives copy by value; only complex storage needs copy_to_memory
        bound_reward: int = int(self.reward_amount)

        def leader_fn():
            try:
                web_res = gl.nondet.web.get(source_url)
            except Exception as e:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Web fetch failed: {e}")
            status = getattr(web_res, "status", 200)
            if int(status) >= 400 and int(status) < 500:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Source returned {status}")
            if int(status) >= 500:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Source temporarily unavailable: {status}")
            raw_body = getattr(web_res, "body", b"")
            if isinstance(raw_body, (bytes, bytearray)):
                try:
                    raw_text = bytes(raw_body).decode("utf-8", errors="ignore")[:300000]
                except Exception:
                    raw_text = str(raw_body)[:300000]
            else:
                raw_text = str(raw_body)[:300000]
            # Strip HTML first, THEN truncate: the article body sits far past the
            # first ~20KB of raw HTML (head/nav/scripts). Live studionet check:
            # 20KB raw → only 333 chars of menu text, zero article content.
            page_text = _html_to_text(raw_text)[:8000]
            if len(page_text.strip()) == 0:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Empty source content")

            prompt = f"""You are the Veritasphere truth validator. Validate a crowdsourced knowledge entry against its source URL.
Topic: {topic}
Title: {title}
Contributor draft summary: {user_summary}
Source page content (truncated to 8000 chars): {page_text}

SOURCE QUALITY GATE (apply first):
- Reject (is_relevant=false, score 0-3) if: paywall/empty/404 text, spam/SEO farm, URL shortener with no content, content unrelated to title/topic, or draft is gibberish.
- Accept only if source contains real, checkable facts supporting the title.

TASKS:
1. Faithfulness: summary must be entailed by the source. No hallucinated names, numbers, dates.
2. Coverage: capture the single main fact + one supporting detail.
3. Produce clean 2-3 sentence summary, same language as source, <=500 chars.

SCORING RUBRIC (0-10):
10 = primary source, novel fact, perfect summary
8-9 = reputable source (wikipedia, official docs, major news), accurate summary
7 = acceptable, minor gaps but factually correct -> ACCEPT threshold
4-6 = thin/derivative source or vague summary -> REJECT
0-3 = spam, irrelevant, hallucinated, empty source -> REJECT

Return JSON only: {{"summary": "...", "score": 0-10, "is_relevant": true/false, "reason": "max 20 words: why this score"}}"""

            try:
                analysis = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception as e:
                raise gl.vm.UserError(f"{ERROR_LLM} LLM call failed: {e}")
            score = _parse_score(analysis)
            summary = _parse_summary(analysis)
            relevant = _parse_relevant(analysis)
            # Deterministic contradiction gate before settlement
            _check_contradiction(int(score), bool(relevant))
            reason = str(analysis.get("reason", ""))[:500] if isinstance(analysis, dict) else ""
            # reason is display-only: never used for the accept decision below.
            if len(summary) < 20:
                raise gl.vm.UserError(f"{ERROR_LLM} LLM summary too short")
            if not _summary_bound_to_evidence(summary, page_text):
                raise gl.vm.UserError(f"{ERROR_LLM} Summary not bound to fetched source")
            return {
                "entry_id": bound_id,
                "source_url": source_url,
                "topic": topic,
                "title": title,
                "reward": bound_reward,
                "evidence_snippet": page_text[:500],
                "page_text": page_text[:4000],
                "summary": summary,
                "score": int(score),
                "is_relevant": bool(relevant),
                "reason": reason,
            }

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            try:
                own = leader_fn()
            except gl.vm.UserError as e:
                msg = e.message if hasattr(e, "message") else str(e)
                if msg.startswith(ERROR_TRANSIENT) or msg.startswith(ERROR_EXTERNAL):
                    # if validator also fails externally, check leader error type matches path
                    return False
                return False
            except Exception:
                return False
            try:
                ldata = leaders_res.calldata
                # 1. Bind to exact record: wrong-record / concurrent-submit protection
                if int(ldata.get("entry_id", -1)) != bound_id:
                    return False
                if str(ldata.get("source_url", "")) != source_url:
                    return False
                if str(ldata.get("topic", "")) != topic:
                    return False
                if str(ldata.get("title", "")) != title:
                    return False
                # 2. Bind exact payout: release amount must match stored terms
                if int(ldata.get("reward", -1)) != bound_reward:
                    return False
                l_score = int(ldata.get("score", -1))
                o_score = int(own.get("score", -2))
                l_rel = bool(ldata.get("is_relevant", False))
                o_rel = bool(own.get("is_relevant", False))
                # gate: relevance decision must match (actual verdict category)
                if l_rel != o_rel:
                    return False
                # gate: reject (score 0) must match
                if (l_score == 0) != (o_score == 0):
                    return False
                # tolerance on score (integer comparison, no float division)
                if abs(l_score - o_score) > SCORE_TOLERANCE:
                    return False
                # summary must be bound to validator's independently fetched evidence
                l_sum = str(ldata.get("summary", ""))
                o_page = str(own.get("page_text", own.get("evidence_snippet", "")))
                if len(l_sum.strip()) < 20:
                    return False
                if not _summary_bound_to_evidence(l_sum, o_page):
                    return False
                return True
            except Exception:
                return False

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        final_summary: str = str(result.get("summary", ""))[:2000]
        # recompute accept deterministically from validated result (reason ignored)
        is_accepted = bool(result.get("is_relevant", False)) and int(result.get("score", 0)) >= ACCEPT_THRESHOLD

        entry = self.entries[u32(entry_id)]
        # Re-check guard after consensus (state could not have changed mid-tx,
        # but double-settle protection is explicit for appeals/retries)
        if entry.status != "PENDING":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Entry {entry_id} already {entry.status}")
        entry.summary = final_summary
        entry.score = u32(int(result.get("score", 0)))
        entry.reason = str(result.get("reason", ""))[:500]
        entry.evidence_snippet = str(result.get("evidence_snippet", ""))[:500]
        entry.status = "ACCEPTED" if is_accepted else "REJECTED"
        entry.settled_reward = u256(bound_reward) if is_accepted else u256(0)
        self.entries[u32(entry_id)] = entry

        if is_accepted:
            contributor = entry.contributor
            cur = self.accepted_count.get(contributor, u32(0))
            self.accepted_count[contributor] = u32(int(cur) + 1)
            # reward payout via external message on finalization
            if bound_reward > 0:
                _Recipient(contributor).emit_transfer(value=u256(bound_reward))
            return f"ACCEPTED id={bound_id} score={int(entry.score)} reward={bound_reward}"
        return f"REJECTED id={bound_id} score={int(entry.score)} reason={entry.reason[:120]}"

    @gl.public.write
    def cancel_pending(self, entry_id: u32) -> str:
        # Unilateral recovery path: if validation stays inconclusive / sources
        # unavailable, contributor or owner can release a stuck PENDING entry.
        # This is the bounded escape so funds/queue never lock indefinitely.
        entry = self._require_entry(u32(entry_id))
        if entry.status != "PENDING":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Entry {entry_id} already {entry.status}")
        sender = gl.message.sender_address
        if sender != entry.contributor and sender != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only contributor or owner can cancel")
        entry.status = "CANCELLED"
        entry.reason = "Cancelled by contributor/owner before validation"
        entry.settled_reward = u256(0)
        self.entries[u32(entry_id)] = entry
        return f"CANCELLED id={int(entry_id)}"

    # ---------- rewards / admin ----------

    @gl.public.write.payable
    def fund_pool(self) -> None:
        if gl.message.value == u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Send some GEN to fund pool")

    @gl.public.write
    def set_reward_amount(self, amount: u256) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        self.reward_amount = amount

    @gl.public.write
    def withdraw(self, amount: u256, to_address: str) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only owner")
        if amount == u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Amount must be > 0")
        _Recipient(self._as_address(to_address)).emit_transfer(value=amount)

    # ---------- views ----------

    @gl.public.view
    def get_entry(self, entry_id: u32) -> dict:
        e = self._require_entry(u32(entry_id))
        return {
            "id": int(entry_id),
            "contributor": str(e.contributor),
            "topic": e.topic,
            "title": e.title,
            "source_url": e.source_url,
            "summary": e.summary,
            "score": int(e.score),
            "status": e.status,
            "reason": e.reason,
            "evidence_snippet": e.evidence_snippet,
            "settled_reward": str(e.settled_reward),
        }

    @gl.public.view
    def get_entries_by_topic(self, topic: str) -> list:
        norm = self._normalize_topic(topic)
        out: list = []
        for eid in range(u32(1), self.next_id):
            eid = u32(eid)
            if eid in self.entries:
                e = self.entries[eid]
                if e.topic == norm:
                    out.append(
                        {
                            "id": int(eid),
                            "title": e.title,
                            "status": e.status,
                            "score": int(e.score),
                            "summary": e.summary,
                        }
                    )
        return out

    @gl.public.view
    def get_stats(self) -> dict:
        total = int(self.next_id) - 1
        topics: list = [t for t in self.topics_list]
        return {
            "name": "Veritasphere",
            "total_entries": total,
            "topics": topics,
            "reward_amount": str(self.reward_amount),
        }

    @gl.public.view
    def get_contributor_stats(self, contributor: str) -> dict:
        addr = self._as_address(contributor)
        return {
            "submitted": int(self.submitted_count.get(addr, u32(0))),
            "accepted": int(self.accepted_count.get(addr, u32(0))),
        }

    # ---------- frontend / AI-consensus reads ----------

    @gl.public.view
    def get_validation_result(self, entry_id: u32) -> dict:
        # Full AI consensus output for frontend display.
        # reason + ai_summary are display-only; settlement used score/is_relevant.
        e = self._require_entry(u32(entry_id))
        reward_out = str(e.settled_reward) if e.status == "ACCEPTED" else "0"
        return {
            "id": int(entry_id),
            "status": e.status,
            "ai_score": int(e.score),
            "ai_summary": e.summary,
            "ai_reason": e.reason,
            "accepted": e.status == "ACCEPTED",
            "threshold": ACCEPT_THRESHOLD,
            "source_url": e.source_url,
            "topic": e.topic,
            "title": e.title,
            "contributor": str(e.contributor),
            "evidence_snippet": e.evidence_snippet,
            "settled_reward": reward_out,
        }

    @gl.public.view
    def get_pending_entries(self) -> list:
        out: list = []
        for eid in range(u32(1), self.next_id):
            eid = u32(eid)
            if eid in self.entries:
                e = self.entries[eid]
                if e.status == "PENDING":
                    out.append(
                        {
                            "id": int(eid),
                            "topic": e.topic,
                            "title": e.title,
                            "source_url": e.source_url,
                            "contributor": str(e.contributor),
                        }
                    )
        return out

    @gl.public.view
    def get_accepted_entries(self, topic: str, limit: u32) -> list:
        norm = self._normalize_topic(topic) if len(topic.strip()) > 0 else ""
        out: list = []
        count = 0
        max_n = int(limit) if int(limit) > 0 else 50
        for eid in range(u32(1), self.next_id):
            if count >= max_n:
                break
            eid = u32(eid)
            if eid in self.entries:
                e = self.entries[eid]
                if e.status == "ACCEPTED" and (norm == "" or e.topic == norm):
                    out.append(
                        {
                            "id": int(eid),
                            "topic": e.topic,
                            "title": e.title,
                            "summary": e.summary,
                            "score": int(e.score),
                            "source_url": e.source_url,
                            "contributor": str(e.contributor),
                        }
                    )
                    count += 1
        return out

    @gl.public.view
    def get_all_entries(self, offset: u32, limit: u32) -> dict:
        start = int(offset) if int(offset) >= 1 else 1
        max_n = int(limit) if int(limit) > 0 else 20
        if max_n > 100:
            max_n = 100
        out: list = []
        end = int(self.next_id)
        i = start
        while i < end and len(out) < max_n:
            eid = u32(i)
            if eid in self.entries:
                e = self.entries[eid]
                out.append(
                    {
                        "id": i,
                        "topic": e.topic,
                        "title": e.title,
                        "status": e.status,
                        "score": int(e.score),
                    }
                )
            i += 1
        return {"total": int(self.next_id) - 1, "entries": out}

    @gl.public.view
    def get_topics(self) -> list:
        return [t for t in self.topics_list]

    @gl.public.view
    def get_leaderboard(self, limit: u32) -> list:
        max_n = int(limit) if int(limit) > 0 else 20
        rows: list = []
        for addr in self.contributors_list:
            rows.append(
                {
                    "contributor": str(addr),
                    "submitted": int(self.submitted_count.get(addr, u32(0))),
                    "accepted": int(self.accepted_count.get(addr, u32(0))),
                }
            )
        # deterministic insertion-sort by accepted desc (small N, MVP)
        n = len(rows)
        for i in range(1, n):
            key = rows[i]
            j = i - 1
            while j >= 0 and int(rows[j]["accepted"]) < int(key["accepted"]):
                rows[j + 1] = rows[j]
                j -= 1
            rows[j + 1] = key
        return rows[:max_n]

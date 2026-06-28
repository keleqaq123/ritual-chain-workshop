import { useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Box,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Code2,
  Copy,
  ExternalLink,
  FileCheck2,
  Gift,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Menu,
  Network,
  Plus,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { formatEther, hexlify, parseEther, randomBytes, solidityPackedKeccak256 } from "ethers";
import { CONTRACT_ADDRESS, getWalletConnection, getWriteContract, hasLiveContract } from "./lib/contract";

type Phase = "COMMIT" | "REVEAL" | "JUDGING" | "FINALIZED";
type ModalKind = "create" | "submit" | "reveal" | "detail" | "owner" | null;
type ToastState = { title: string; message: string; kind?: "success" | "error" | "info" } | null;

type Bounty = {
  id: number;
  title: string;
  description: string;
  reward: string;
  skill: string;
  difficulty: string;
  phase: Phase;
  deadline: string;
  submissions: number;
  icon: "code" | "ai" | "box" | "shield";
  owner?: boolean;
};

const seedBounties: Bounty[] = [
  {
    id: 1,
    title: "Build a Privacy-Preserving Voting DApp",
    description: "Design a practical voting flow that keeps ballots private while maintaining an auditable result.",
    reward: "0.50",
    skill: "Solidity",
    difficulty: "Intermediate",
    phase: "COMMIT",
    deadline: "Ends in 2d 14h",
    submissions: 8,
    icon: "code",
  },
  {
    id: 2,
    title: "AI Agent for On-chain Analytics",
    description: "Propose an agent architecture that can analyze activity without leaking sensitive user signals.",
    reward: "0.30",
    skill: "AI",
    difficulty: "Advanced",
    phase: "REVEAL",
    deadline: "Reveal window: 1d 6h",
    submissions: 11,
    icon: "ai",
  },
  {
    id: 3,
    title: "Best zkProof Integration",
    description: "Recommend a minimal, trustworthy zk proof integration for an EVM application.",
    reward: "0.25",
    skill: "ZK",
    difficulty: "Advanced",
    phase: "JUDGING",
    deadline: "Batch judging in progress",
    submissions: 15,
    icon: "box",
    owner: true,
  },
  {
    id: 4,
    title: "Ritual Native App Design",
    description: "Design a user-friendly app pattern for TEE-backed private inputs and model evaluation.",
    reward: "0.20",
    skill: "Design",
    difficulty: "Beginner",
    phase: "FINALIZED",
    deadline: "Winner selected",
    submissions: 5,
    icon: "shield",
  },
];

const phaseMeta: Record<Phase, { label: string; className: string; detail: string }> = {
  COMMIT: { label: "SUBMISSION", className: "phase-commit", detail: "Commitment window open" },
  REVEAL: { label: "REVEAL", className: "phase-reveal", detail: "Answers can now be verified" },
  JUDGING: { label: "JUDGING", className: "phase-judging", detail: "Ritual batch evaluation" },
  FINALIZED: { label: "COMPLETED", className: "phase-final", detail: "Winner finalized on-chain" },
};

const mySubmissions = [
  { id: 1, title: "Build a Privacy-Preserving Voting DApp", state: "Committed", phase: "SUBMITTED", time: "2 days ago" },
  { id: 2, title: "AI Agent for On-chain Analytics", state: "Reveal pending", phase: "READY TO REVEAL", time: "1 day ago" },
  { id: 3, title: "Best zkProof Integration", state: "Under judging", phase: "JUDGING", time: "3 hours ago" },
  { id: 4, title: "Ritual Native App Design", state: "Not selected", phase: "NOT SELECTED", time: "1 day ago" },
];

const nav = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Bounties", icon: Gift },
  { label: "My Submissions", icon: ClipboardCheck },
  { label: "Create Bounty", icon: Plus },
  { label: "Profile", icon: UserRound },
  { label: "Docs", icon: FileCheck2 },
];

function truncateAddress(value: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Connect wallet";
}

function titleIcon(type: Bounty["icon"]) {
  if (type === "ai") return <Sparkles size={21} />;
  if (type === "box") return <Box size={21} />;
  if (type === "shield") return <ShieldCheck size={21} />;
  return <Code2 size={21} />;
}

function getStoredSubmission(id: number) {
  const raw = localStorage.getItem(`ritual-bounty:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { answer: string; salt: string; commitment: string };
  } catch {
    return null;
  }
}

function App() {
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [bounties, setBounties] = useState(seedBounties);
  const [selectedBounty, setSelectedBounty] = useState<Bounty | null>(seedBounties[0]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("1.2459");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [createForm, setCreateForm] = useState({ title: "", reward: "0.10", submissionDays: "2", revealDays: "2" });
  const [answer, setAnswer] = useState("");
  const [ownerPayload, setOwnerPayload] = useState('{\n  "winnerIndex": 0,\n  "summary": "Batch judging recommendation"\n}');
  const [winnerIndex, setWinnerIndex] = useState("0");

  const totalReward = useMemo(
    () => bounties.reduce((sum, item) => sum + Number(item.reward), 0).toFixed(2),
    [bounties],
  );

  const isLive = hasLiveContract();

  const showToast = (title: string, message: string, kind: ToastState extends never ? never : "success" | "error" | "info" = "success") => {
    setToast({ title, message, kind });
    window.setTimeout(() => setToast(null), 4300);
  };

  const connectWallet = async () => {
    try {
      setBusy(true);
      const { provider, address } = await getWalletConnection();
      const balance = await provider.getBalance(address);
      setWalletAddress(address);
      setWalletBalance(Number(formatEther(balance)).toFixed(4));
      showToast("Wallet connected", `${truncateAddress(address)} is ready to interact with the bounty contract.`);
    } catch (error) {
      showToast("Connection failed", error instanceof Error ? error.message : "Unable to connect the wallet.", "error");
    } finally {
      setBusy(false);
    }
  };

  const openBounty = (bounty: Bounty) => {
    setSelectedBounty(bounty);
    setModal("detail");
  };

  const submitCommitment = async () => {
    if (!selectedBounty) return;
    if (!answer.trim()) {
      showToast("Answer required", "Write your answer before generating a commitment.", "error");
      return;
    }

    try {
      setBusy(true);
      let address = walletAddress;
      if (!address) {
        const connected = await getWalletConnection();
        address = connected.address;
        setWalletAddress(address);
      }

      const salt = hexlify(randomBytes(32));
      const commitment = solidityPackedKeccak256(
        ["string", "bytes32", "address", "uint256"],
        [answer.trim(), salt, address, BigInt(selectedBounty.id)],
      );

      localStorage.setItem(
        `ritual-bounty:${selectedBounty.id}`,
        JSON.stringify({ answer: answer.trim(), salt, commitment }),
      );

      if (isLive) {
        const contract = await getWriteContract();
        const tx = await contract.submitCommitment(selectedBounty.id, commitment);
        await tx.wait();
        showToast("Commitment submitted", `On-chain transaction confirmed: ${tx.hash.slice(0, 10)}…`);
      } else {
        showToast("Commitment created", "Saved locally in Demo Mode. Add VITE_CONTRACT_ADDRESS to submit it on-chain.", "info");
      }

      setModal(null);
      setAnswer("");
    } catch (error) {
      showToast("Commit failed", error instanceof Error ? error.message : "The commitment could not be submitted.", "error");
    } finally {
      setBusy(false);
    }
  };

  const revealStoredAnswer = async () => {
    if (!selectedBounty) return;
    const saved = getStoredSubmission(selectedBounty.id);
    if (!saved) {
      showToast("No saved commitment", "Create a commitment from this browser before attempting a reveal.", "error");
      return;
    }

    try {
      setBusy(true);
      if (isLive) {
        const contract = await getWriteContract();
        const tx = await contract.revealAnswer(selectedBounty.id, saved.answer, saved.salt);
        await tx.wait();
        showToast("Answer revealed", `Your answer was verified on-chain: ${tx.hash.slice(0, 10)}…`);
      } else {
        showToast("Reveal preview ready", "Demo Mode verified that this browser holds an answer and salt. Use a deployed contract for the live reveal.", "info");
      }
      setModal(null);
    } catch (error) {
      showToast("Reveal failed", error instanceof Error ? error.message : "The answer could not be revealed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const createBounty = async () => {
    if (!createForm.title.trim()) {
      showToast("Title required", "Give the bounty a clear, public title.", "error");
      return;
    }
    const rewardNumber = Number(createForm.reward);
    if (!Number.isFinite(rewardNumber) || rewardNumber <= 0) {
      showToast("Invalid reward", "Enter a reward greater than zero.", "error");
      return;
    }

    try {
      setBusy(true);
      if (isLive) {
        const contract = await getWriteContract();
        const now = Math.floor(Date.now() / 1000);
        const submissionDeadline = now + Number(createForm.submissionDays) * 24 * 60 * 60;
        const revealDeadline = submissionDeadline + Number(createForm.revealDays) * 24 * 60 * 60;
        const tx = await contract.createBounty(submissionDeadline, revealDeadline, { value: parseEther(createForm.reward) });
        await tx.wait();
        showToast("Bounty created", `Escrow transaction confirmed: ${tx.hash.slice(0, 10)}…`);
      } else {
        showToast("Bounty drafted", "Demo Mode added the bounty locally. Add VITE_CONTRACT_ADDRESS to escrow the reward on-chain.", "info");
      }

      const bounty: Bounty = {
        id: Math.max(...bounties.map((item) => item.id)) + 1,
        title: createForm.title.trim(),
        description: "A new bounty created from this dashboard. Configure the full rubric in the contract workflow.",
        reward: createForm.reward,
        skill: "Solidity",
        difficulty: "Intermediate",
        phase: "COMMIT",
        deadline: `Ends in ${createForm.submissionDays}d`,
        submissions: 0,
        icon: "shield",
        owner: true,
      };
      setBounties((previous) => [bounty, ...previous]);
      setSelectedBounty(bounty);
      setCreateForm({ title: "", reward: "0.10", submissionDays: "2", revealDays: "2" });
      setModal(null);
    } catch (error) {
      showToast("Create failed", error instanceof Error ? error.message : "The bounty could not be created.", "error");
    } finally {
      setBusy(false);
    }
  };

  const recordBatchResult = async () => {
    if (!selectedBounty) return;
    try {
      JSON.parse(ownerPayload);
    } catch {
      showToast("Invalid JSON", "The canonical batch result must be valid JSON.", "error");
      return;
    }

    try {
      setBusy(true);
      if (isLive) {
        const contract = await getWriteContract();
        const tx = await contract.judgeAll(selectedBounty.id, new TextEncoder().encode(ownerPayload));
        await tx.wait();
        showToast("Batch result recorded", `Ritual result hash was committed: ${tx.hash.slice(0, 10)}…`);
      } else {
        showToast("Batch result preview", "Demo Mode recorded a simulated batch result. A live contract stores only the payload hash.", "info");
      }
      setBounties((previous) => previous.map((item) => item.id === selectedBounty.id ? { ...item, phase: "JUDGING" } : item));
    } catch (error) {
      showToast("Judging failed", error instanceof Error ? error.message : "The batch result could not be recorded.", "error");
    } finally {
      setBusy(false);
    }
  };

  const finalizeWinner = async () => {
    if (!selectedBounty) return;
    const index = Number(winnerIndex);
    if (!Number.isInteger(index) || index < 0) {
      showToast("Invalid winner index", "Use a non-negative submission index.", "error");
      return;
    }
    try {
      setBusy(true);
      if (isLive) {
        const contract = await getWriteContract();
        const tx = await contract.finalizeWinner(selectedBounty.id, index);
        await tx.wait();
        showToast("Winner finalized", `The reward payout was confirmed: ${tx.hash.slice(0, 10)}…`);
      } else {
        showToast("Winner preview", "Demo Mode marked a simulated winner. Live finalization requires an eligible revealed submission.", "info");
      }
      setBounties((previous) => previous.map((item) => item.id === selectedBounty.id ? { ...item, phase: "FINALIZED", deadline: "Winner selected" } : item));
      setModal(null);
    } catch (error) {
      showToast("Finalization failed", error instanceof Error ? error.message : "The winner could not be finalized.", "error");
    } finally {
      setBusy(false);
    }
  };

  const quickAction = () => {
    if (!selectedBounty) return;
    if (selectedBounty.phase === "COMMIT") setModal("submit");
    else if (selectedBounty.phase === "REVEAL") setModal("reveal");
    else if (selectedBounty.owner) setModal("owner");
    else setModal("detail");
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-spacer" aria-hidden="true" />
        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.label;
            return (
              <button
                key={item.label}
                className={`nav-item ${active ? "nav-active" : ""}`}
                onClick={() => {
                  setActiveNav(item.label);
                  setMobileNavOpen(false);
                  if (item.label === "Create Bounty") setModal("create");
                }}
              >
                <Icon size={19} strokeWidth={active ? 2.3 : 1.9} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-card-head">
              <div className="mini-orb"><Sparkles size={13} /></div>
              <strong>{import.meta.env.VITE_NETWORK_NAME || "Ritual Testnet"}</strong>
              <span className="live-dot">Live</span>
            </div>
            <dl>
              <div><dt>Contract</dt><dd>{isLive ? "Configured" : "Demo mode"}</dd></div>
              <div><dt>Balance</dt><dd>{walletBalance} rBTC</dd></div>
            </dl>
            <button className="outline-button compact" onClick={() => showToast("Faucet link", "Connect this button to the current Ritual faucet URL for your testnet.", "info")}>
              <CircleDollarSign size={16} /> Faucet
            </button>
          </div>
          <div className="appearance-switch" aria-label="Appearance controls">
            <button title="Light appearance"><Sparkles size={17} /></button>
            <button title="Dim appearance"><span className="moon">◔</span></button>
          </div>
        </div>
      </aside>

      {mobileNavOpen && <button className="backdrop" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="topbar-spacer" />
          <button className="network-select">
            <span className="status-dot" />
            {import.meta.env.VITE_NETWORK_NAME || "Ritual Testnet"}
            <ChevronDown size={16} />
          </button>
          <button className="wallet-select" onClick={connectWallet} disabled={busy}>
            <span className="wallet-avatar"><WalletCards size={17} /></span>
            <span>{walletAddress ? truncateAddress(walletAddress) : "Connect wallet"}</span>
            <ChevronDown size={16} />
          </button>
          <button className="bell-button" aria-label="Notifications">
            <Bell size={20} />
            <span>2</span>
          </button>
        </header>

        <section className="page-content">
          <section className="hero-card">
            <div className="hero-copy">
              <div className="eyebrow"><LockKeyhole size={15} /> Private by design</div>
              <h1>Privacy-Preserving <span>AI Bounty Judge</span></h1>
              <p>Commit privately. Reveal fairly. Let Ritual evaluate every eligible answer in one batch.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => setModal("create")}><Plus size={19} /> Create bounty</button>
                <button className="outline-button" onClick={() => selectedBounty && openBounty(selectedBounty)}><Network size={18} /> How it works</button>
              </div>
              <div className="demo-pill"><span className={isLive ? "status-dot" : "demo-dot"} /> {isLive ? "Live contract actions enabled" : "Demo Mode · add contract address for live actions"}</div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="shield-glow"><ShieldCheck size={110} strokeWidth={1.15} /></div>
              <div className="lock-badge"><LockKeyhole size={38} /></div>
              <div className="base-ring" />
            </div>
            <div className="hero-proof-card">
              <h3>Commit-Reveal + Ritual TEE</h3>
              <ul>
                <li><Check size={15} /> Submissions stay hidden</li>
                <li><Check size={15} /> One batch AI evaluation</li>
                <li><Check size={15} /> Human finalizes payout</li>
                <li><Check size={15} /> On-chain audit trail</li>
              </ul>
            </div>
          </section>

          <section className="stat-grid">
            <StatCard icon={<Gift />} label="Active Bounties" value={String(bounties.length)} detail="+2 this week" tone="blue" />
            <StatCard icon={<ClipboardCheck />} label="Total Submissions" value={String(bounties.reduce((sum, item) => sum + item.submissions, 0))} detail="+7 this week" tone="sky" />
            <StatCard icon={<Trophy />} label="Rewards Escrowed" value={`${totalReward} rBTC`} detail="Across 5 bounties" tone="green" />
            <StatCard icon={<UserRound />} label="Active Participants" value="18" detail="+3 this week" tone="amber" />
          </section>

          <section className="content-grid">
            <article className="panel bounty-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Explore</p>
                  <h2>Active Bounties</h2>
                </div>
                <button className="text-button" onClick={() => setActiveNav("Bounties")}>View all <ArrowRight size={15} /></button>
              </div>
              <div className="bounty-list">
                {bounties.map((bounty) => (
                  <button className="bounty-row" key={bounty.id} onClick={() => openBounty(bounty)}>
                    <span className={`bounty-icon icon-${bounty.icon}`}>{titleIcon(bounty.icon)}</span>
                    <span className="bounty-content">
                      <strong>{bounty.title}</strong>
                      <small>{bounty.reward} rBTC <i /> {bounty.skill} <i /> {bounty.difficulty}</small>
                    </span>
                    <span className="bounty-status">
                      <span className={`phase-chip ${phaseMeta[bounty.phase].className}`}>{phaseMeta[bounty.phase].label}</span>
                      <small>{bounty.deadline}</small>
                    </span>
                    <ArrowRight size={18} className="row-arrow" />
                  </button>
                ))}
              </div>
            </article>

            <article className="panel submissions-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Your work</p>
                  <h2>My Submissions</h2>
                </div>
                <button className="text-button" onClick={() => setActiveNav("My Submissions")}>View all <ArrowRight size={15} /></button>
              </div>
              <div className="submission-list">
                {mySubmissions.map((item) => (
                  <button className="submission-row" key={item.id} onClick={() => openBounty(bounties.find((bounty) => bounty.id === item.id) ?? bounties[0])}>
                    <span><strong>{item.title}</strong><small>{item.state}</small></span>
                    <span className="submission-meta"><span className={`micro-chip ${item.phase.toLowerCase().split(" ").join("-")}`}>{item.phase}</span><small>{item.time}</small></span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
            </article>
          </section>

          <section className="contract-footer">
            <div className="contract-info">
              <span className="verified-icon"><BadgeCheck size={19} /></span>
              <div>
                <strong>Bounty Judge Contract <span>Verified</span></strong>
                <p>{isLive ? `Address: ${truncateAddress(CONTRACT_ADDRESS)}` : "Contract: configure VITE_CONTRACT_ADDRESS for live interactions"}</p>
              </div>
            </div>
            <div className="contract-network"><span>Network:</span> {import.meta.env.VITE_NETWORK_NAME || "Ritual Testnet"}</div>
            <button className="text-button" onClick={() => showToast("Explorer", isLive ? "Add your explorer URL in VITE_BLOCK_EXPLORER_URL to open it here." : "Deploy first, then configure your contract and explorer URL.", "info")}>View on Explorer <ExternalLink size={15} /></button>
          </section>
        </section>
      </main>

      <button className="floating-create" onClick={() => setModal("create")}><Plus size={21} /> Create</button>

      {modal === "create" && (
        <Dialog title="Create a bounty" subtitle="Escrow a reward and define separate commit and reveal windows." onClose={() => setModal(null)}>
          <div className="form-grid">
            <label className="field field-wide"><span>Bounty title</span><input value={createForm.title} onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })} placeholder="e.g. Design a private voting flow" /></label>
            <label className="field"><span>Reward (rBTC)</span><input type="number" min="0.01" step="0.01" value={createForm.reward} onChange={(event) => setCreateForm({ ...createForm, reward: event.target.value })} /></label>
            <label className="field"><span>Commit window (days)</span><input type="number" min="1" value={createForm.submissionDays} onChange={(event) => setCreateForm({ ...createForm, submissionDays: event.target.value })} /></label>
            <label className="field"><span>Reveal window (days)</span><input type="number" min="1" value={createForm.revealDays} onChange={(event) => setCreateForm({ ...createForm, revealDays: event.target.value })} /></label>
          </div>
          <div className="notice-card"><ShieldCheck size={19} /><p>The contract stores the reward and public deadlines. Answers are never submitted in plaintext during the commit phase.</p></div>
          <div className="dialog-actions"><button className="outline-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={createBounty}>{busy && <Loader2 className="spin" size={17} />} Create bounty</button></div>
        </Dialog>
      )}

      {modal === "submit" && selectedBounty && (
        <Dialog title="Commit a private answer" subtitle={`Bounty #${selectedBounty.id} · ${selectedBounty.title}`} onClose={() => setModal(null)}>
          <div className="privacy-banner"><LockKeyhole size={18} /><div><strong>Your answer stays local until reveal.</strong><p>The interface creates a random salt and uses the exact contract commitment formula.</p></div></div>
          <label className="field"><span>Your answer</span><textarea rows={7} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write the answer you want to commit. It will not be shown publicly now." /></label>
          <div className="code-chip">keccak256(answer, salt, wallet, bountyId)</div>
          <div className="dialog-actions"><button className="outline-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={submitCommitment}>{busy && <Loader2 className="spin" size={17} />} Generate & submit commitment</button></div>
        </Dialog>
      )}

      {modal === "reveal" && selectedBounty && (
        <Dialog title="Reveal your answer" subtitle={`Bounty #${selectedBounty.id} · Reveal phase`} onClose={() => setModal(null)}>
          <div className="reveal-review">
            <span className="bounty-icon icon-ai"><LockKeyhole size={21} /></span>
            <div><strong>{getStoredSubmission(selectedBounty.id) ? "Saved answer found" : "No saved answer found"}</strong><p>{getStoredSubmission(selectedBounty.id) ? "This browser has the answer and salt required for a valid reveal." : "The saved answer and salt must exist in this browser for this demo."}</p></div>
          </div>
          <div className="notice-card"><ShieldCheck size={19} /><p>The contract recomputes the commitment with your answer, salt, connected wallet, and bounty ID. A mismatch reverts.</p></div>
          <div className="dialog-actions"><button className="outline-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={busy} onClick={revealStoredAnswer}>{busy && <Loader2 className="spin" size={17} />} Reveal & verify</button></div>
        </Dialog>
      )}

      {modal === "detail" && selectedBounty && (
        <Dialog title={selectedBounty.title} subtitle={`Bounty #${selectedBounty.id} · ${phaseMeta[selectedBounty.phase].detail}`} onClose={() => setModal(null)} wide>
          <div className="detail-hero">
            <span className={`bounty-icon icon-${selectedBounty.icon}`}>{titleIcon(selectedBounty.icon)}</span>
            <div><p>{selectedBounty.description}</p><div className="detail-tags"><span>{selectedBounty.reward} rBTC reward</span><span>{selectedBounty.skill}</span><span>{selectedBounty.difficulty}</span></div></div>
          </div>
          <div className="timeline">
            <TimelineStep number="1" title="Commit" detail="Hash only, no plaintext answer" done />
            <TimelineStep number="2" title="Reveal" detail="Answer + salt are verified" done={selectedBounty.phase !== "COMMIT"} />
            <TimelineStep number="3" title="Ritual batch judge" detail="One private evaluation request" done={selectedBounty.phase === "JUDGING" || selectedBounty.phase === "FINALIZED"} />
            <TimelineStep number="4" title="Finalize" detail="Human approves the payout" done={selectedBounty.phase === "FINALIZED"} />
          </div>
          <div className="dialog-actions"><button className="outline-button" onClick={() => setModal(null)}>Close</button><button className="primary-button" onClick={quickAction}>{selectedBounty.phase === "COMMIT" ? "Submit commitment" : selectedBounty.phase === "REVEAL" ? "Reveal answer" : selectedBounty.owner ? "Owner actions" : "View lifecycle"}</button></div>
        </Dialog>
      )}

      {modal === "owner" && selectedBounty && (
        <Dialog title="Owner actions" subtitle="Record one canonical Ritual batch result, then finalize an eligible winner." onClose={() => setModal(null)} wide>
          <div className="owner-grid">
            <section className="owner-section">
              <div className="section-title"><Sparkles size={18} /> <strong>1. Batch judging result</strong></div>
              <p>Submit one canonical JSON result after the reveal deadline. The Solidity contract stores only its hash.</p>
              <textarea className="payload-area" rows={9} value={ownerPayload} onChange={(event) => setOwnerPayload(event.target.value)} />
              <button className="primary-button full-width" disabled={busy} onClick={recordBatchResult}>{busy && <Loader2 className="spin" size={17} />} Record batch result</button>
            </section>
            <section className="owner-section">
              <div className="section-title"><Trophy size={18} /> <strong>2. Finalize a winner</strong></div>
              <p>A human reviews the AI recommendation and selects a revealed submission index. The contract rejects unrevealed winners.</p>
              <label className="field"><span>Winner submission index</span><input type="number" min="0" value={winnerIndex} onChange={(event) => setWinnerIndex(event.target.value)} /></label>
              <button className="primary-button full-width" disabled={busy} onClick={finalizeWinner}>{busy && <Loader2 className="spin" size={17} />} Finalize winner</button>
              <div className="notice-card small"><ShieldCheck size={17} /><p>No automatic payout is made from arbitrary LLM text.</p></div>
            </section>
          </div>
        </Dialog>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind ?? "success"}`} role="status">
          <div className="toast-icon">{toast.kind === "error" ? <X size={18} /> : toast.kind === "info" ? <Sparkles size={18} /> : <Check size={18} />}</div>
          <div><strong>{toast.title}</strong><p>{toast.message}</p></div>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className="stat-card"><span className={`stat-icon tone-${tone}`}>{icon}</span><div><p>{label}</p><h3>{value}</h3><small>{detail}</small></div></article>;
}

function TimelineStep({ number, title, detail, done }: { number: string; title: string; detail: string; done?: boolean }) {
  return <div className={`timeline-step ${done ? "timeline-done" : ""}`}><span>{done ? <Check size={14} /> : number}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
}

function Dialog({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-backdrop" aria-label="Close dialog" onClick={onClose} /><section className={`dialog ${wide ? "dialog-wide" : ""}`}><header className="dialog-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header><div className="dialog-body">{children}</div></section></div>;
}

export default App;

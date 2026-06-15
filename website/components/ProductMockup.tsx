import styles from "./ProductMockup.module.css";

type ProductMockupProps = {
  size?: "hero" | "spread";
  /* Fill mode: primary window fills the container, no offset secondary window.
     Used as the DemoFrame loading fallback so it matches the iframe footprint. */
  fill?: boolean;
};

const FILE_TREE = [
  { label: "research-notes", depth: 0, kind: "file", selected: true },
  { label: "project-plan", depth: 0, kind: "file" },
  { label: "meeting-2026-06-08", depth: 0, kind: "file" },
  { label: ".marvin", depth: 0, kind: "folder" },
  { label: "snapshots", depth: 1, kind: "folder" },
] as const;

function Topbar() {
  return (
    <div className={styles.topbar}>
      {/* Native macOS window chrome (Electron hiddenInset) — traffic lights are
          drawn by the OS on the real app, so the web frame reproduces them. */}
      <span className={styles.lights} aria-hidden="true">
        <span className={styles.light + " " + styles.lightRed} />
        <span className={styles.light + " " + styles.lightYellow} />
        <span className={styles.light + " " + styles.lightGreen} />
      </span>
      <span className={styles.panelToggle} aria-hidden="true" />
      <span className={styles.search}>
        <span className={styles.searchIcon} aria-hidden="true" />
        Search files…
        <span className={styles.kbd}>⌘P</span>
      </span>
      <span className={styles.gear} aria-hidden="true" />
    </div>
  );
}

function TabBar() {
  return (
    <div className={styles.tabBar}>
      <span className={styles.tab + " " + styles.tabActive}>
        <span className={styles.tabIcon} aria-hidden="true" />
        research-notes.md
        <span className={styles.tabClose} aria-hidden="true">
          ×
        </span>
      </span>
      <span className={styles.tab}>
        <span className={styles.tabIcon} aria-hidden="true" />
        project-plan.md
      </span>
      <span className={styles.tabNew} aria-hidden="true">
        +
      </span>
    </div>
  );
}

function Sidebar() {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.projectName}>Marvinz</span>
        <span className={styles.toolbarIcons} aria-hidden="true">
          <span className={styles.iconBtn} />
          <span className={styles.iconBtn} />
        </span>
      </div>
      <div className={styles.fileTree}>
        {FILE_TREE.map((item) => (
          <div
            key={item.label}
            className={
              styles.treeRow +
              (item.kind === "folder" ? " " + styles.treeFolder : "") +
              ("selected" in item && item.selected ? " " + styles.treeSelected : "")
            }
            style={{ paddingLeft: `calc(${item.depth} * 14px + var(--space-2))` }}
          >
            <span className={styles.treeIcon} aria-hidden="true">
              {item.kind === "folder" ? "›" : ""}
            </span>
            <span className={styles.treeName}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Editor() {
  return (
    <div className={styles.editorPane}>
      <TabBar />
      <div className={styles.editor}>
        <p className={styles.mdH}># Snapshot restore — decision log</p>
        <p className={styles.mdBlank}>&nbsp;</p>
        <p className={styles.mdH}>## Context</p>
        <p className={styles.mdLine}>Exploring two restore strategies after agent turn:</p>
        <p className={styles.mdLine}>
          - <b className={styles.mdBold}>**Full vault replace**</b> — simpler, destroys concurrent edits
        </p>
        <p className={styles.mdLine}>
          - <b className={styles.mdBold}>**File-level patch**</b> — surgical, conflict detection needed
        </p>
        <p className={styles.mdBlank}>&nbsp;</p>
        <p className={styles.mdH}>## Decision</p>
        <p className={styles.mdLine}>
          Go with file-level patch (<code className={styles.mdCode}>.marvin/snapshots/&lt;turn-id&gt;</code>).
        </p>
        <p className={styles.mdLine}>
          Rationale: vault may have unsaved work in open tabs.<span className={styles.caret} />
        </p>
        <p className={styles.mdBlank}>&nbsp;</p>
        <p className={styles.mdH}>## Open questions</p>
        <p className={styles.mdLine}>- [ ] Binary files in snapshot?</p>
        <p className={styles.mdLine}>- [ ] Conflict UX when agent + user edit same file</p>
      </div>
    </div>
  );
}

function ClaudePane() {
  return (
    <div className={styles.claudePane}>
      <div className={styles.claudeHeader}>
        <span className={styles.claudeDot} aria-hidden="true" />
        Claude Code
        <span className={styles.providerPill}>claude-opus</span>
      </div>

      <div className={styles.chatBody}>
        <p className={styles.assistantMsg}>
          Updated research-notes.md with the file-level patch decision. Snapshot saved at
          .marvin/snapshots/2026-06-09T14-22.
        </p>

        <div className={styles.approvalGate}>
          <span className={styles.toolLabel}>write_file research-notes.md</span>
          <span className={styles.approveBtn}>Allow</span>
          <span className={styles.denyBtn}>Deny</span>
        </div>
      </div>

      <div className={styles.composer}>
        <span className={styles.composerInput}>Ask Claude Code…</span>
      </div>
    </div>
  );
}

function PrimaryWindow() {
  return (
    <div className={styles.window + " " + styles.primary}>
      <Topbar />
      <div className={styles.panes}>
        <Sidebar />
        <Editor />
        <ClaudePane />
      </div>
    </div>
  );
}

function SecondaryWindow() {
  return (
    <div className={styles.window + " " + styles.secondary}>
      <div className={styles.editorPane}>
        <div className={styles.tabBar}>
          <span className={styles.tab + " " + styles.tabActive}>
            <span className={styles.tabIcon} aria-hidden="true" />
            project-plan.md
          </span>
        </div>
        <div className={styles.editor}>
          <p className={styles.mdH}># Project plan — Q3</p>
          <p className={styles.mdBlank}>&nbsp;</p>
          <p className={styles.mdH}>## Milestones</p>
          <p className={styles.mdLine}>- [x] Snapshot engine</p>
          <p className={styles.mdLine}>- [ ] Restore UX</p>
          <p className={styles.mdLine}>- [ ] Approvable tool calls</p>
        </div>
      </div>
    </div>
  );
}

export function ProductMockup({ size = "hero", fill = false }: ProductMockupProps) {
  return (
    <div
      className={
        styles.stage +
        " " +
        (size === "spread" ? styles.spread : styles.hero) +
        (fill ? " " + styles.fill : "")
      }
      role="img"
      aria-label="Marvinz workspace — file tree, markdown editor, and Claude Code agent panel"
    >
      <div className={styles.layers} aria-hidden="true">
        <SecondaryWindow />
        <PrimaryWindow />
      </div>
    </div>
  );
}

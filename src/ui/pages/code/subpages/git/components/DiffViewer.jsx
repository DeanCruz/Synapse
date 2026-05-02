import React, { useMemo } from 'react';
import { useAppState } from '../../context/AppContext.jsx';
import '../../styles/git-manager.css';

function isBinaryDiff(raw) {
  if (!raw || typeof raw !== 'string') return false;
  const head = raw.substring(0, 300);
  return head.includes('Binary files') || head.includes('GIT binary patch') || head.includes('Binary file ');
}

function parseDiff(raw) {
  if (!raw || typeof raw !== 'string') return { hunks: [], additions: 0, deletions: 0 };

  const lines = raw.split('\n');
  const hunks = [];
  let current = null;
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('---') || line.startsWith('+++') ||
        line.startsWith('new file') || line.startsWith('deleted file') ||
        line.startsWith('old mode') || line.startsWith('new mode') ||
        line.startsWith('similarity index') || line.startsWith('rename from') ||
        line.startsWith('rename to') || line.startsWith('copy from') ||
        line.startsWith('copy to')) {
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)?$/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      current = { header: line, context: (hunkMatch[3] || '').trim(), lines: [] };
      hunks.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith('+')) {
      additions++;
      current.lines.push({ type: 'added', oldNum: null, newNum: newLine, content: line.substring(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      deletions++;
      current.lines.push({ type: 'removed', oldNum: oldLine, newNum: null, content: line.substring(1) });
      oldLine++;
    } else if (line.startsWith('\\')) {
      current.lines.push({ type: 'info', oldNum: null, newNum: null, content: line });
    } else {
      const content = line.startsWith(' ') ? line.substring(1) : line;
      current.lines.push({ type: 'context', oldNum: oldLine, newNum: newLine, content });
      oldLine++;
      newLine++;
    }
  }

  return { hunks, additions, deletions };
}

const STATUS_CLASS = {
  M: 'modified', A: 'added', D: 'deleted', R: 'renamed', U: 'untracked', '?': 'untracked', T: 'modified', C: 'conflicted',
};

function statusCls(code) {
  return STATUS_CLASS[code] || STATUS_CLASS[code?.[0]] || 'modified';
}

export default function DiffViewer({ diff, filePath, fileStatus }) {
  const state = useAppState();
  const diffContent = diff !== undefined ? diff : state.gitDiff;
  const selectedFile = filePath || state.gitSelectedFile;

  const binary = useMemo(() => isBinaryDiff(diffContent), [diffContent]);
  const parsed = useMemo(() => parseDiff(diffContent), [diffContent]);

  if (!selectedFile) {
    return (
      <div className="git-manager-diff">
        <div className="git-manager-empty">
          <div className="git-manager-empty-title">No file selected</div>
          <div className="git-manager-empty-text">Select a file from the changes panel to view its diff</div>
        </div>
      </div>
    );
  }

  if (binary) {
    return (
      <div className="git-manager-diff" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="git-manager-diff-file-header">
          {fileStatus && <span className={`git-manager-file-status ${statusCls(fileStatus)}`}>{fileStatus}</span>}
          <span>{selectedFile}</span>
        </div>
        <div className="git-manager-empty">
          <div className="git-manager-empty-title">Binary file</div>
          <div className="git-manager-empty-text">Cannot display diff for binary files</div>
        </div>
      </div>
    );
  }

  if (!diffContent || parsed.hunks.length === 0) {
    return (
      <div className="git-manager-diff" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="git-manager-diff-file-header">
          {fileStatus && <span className={`git-manager-file-status ${statusCls(fileStatus)}`}>{fileStatus}</span>}
          <span>{selectedFile}</span>
        </div>
        <div className="git-manager-empty">
          <div className="git-manager-empty-text">
            {!diffContent ? 'No changes to display' : 'Empty diff'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-manager-diff" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="git-manager-diff-file-header">
        {fileStatus && <span className={`git-manager-file-status ${statusCls(fileStatus)}`}>{fileStatus}</span>}
        <span>{selectedFile}</span>
        <div className="git-manager-diff-stats">
          {parsed.additions > 0 && <span className="git-manager-diff-stats-add">+{parsed.additions}</span>}
          {parsed.deletions > 0 && <span className="git-manager-diff-stats-del">-{parsed.deletions}</span>}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {parsed.hunks.map((hunk, hi) => (
          <div key={hi}>
            <div className="git-manager-diff-hunk">{hunk.header}</div>
            {hunk.lines.map((line, li) => {
              if (line.type === 'info') {
                return (
                  <div key={li} className="git-manager-diff-line context">
                    <span className="git-manager-diff-line-num" />
                    <span className="git-manager-diff-line-num" />
                    <span className="git-manager-diff-line-content" style={{ fontStyle: 'italic', opacity: 0.6 }}>
                      {line.content}
                    </span>
                  </div>
                );
              }
              const cls = line.type === 'added' ? 'added' : line.type === 'removed' ? 'removed' : 'context';
              const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
              return (
                <div key={li} className={`git-manager-diff-line ${cls}`}>
                  <span className="git-manager-diff-line-num">{line.oldNum != null ? line.oldNum : ''}</span>
                  <span className="git-manager-diff-line-num">{line.newNum != null ? line.newNum : ''}</span>
                  <span className="git-manager-diff-line-content">{prefix}{line.content}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export { parseDiff };

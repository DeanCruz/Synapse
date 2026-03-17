// StatsBar — six stat cards: Total, Completed, In Progress, Failed, Pending, Elapsed
// Each card is clickable to filter agents. Elapsed card opens the timeline panel.

import React, { useState, useEffect, useCallback } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';
import { formatElapsed, calcDuration } from '@/utils/format.js';

function StatCard({ id, value, label, numberClass, isActive, onClick }) {
  return (
    <div
      className={`stat-card${isActive ? ' stat-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <span className={`stat-number ${numberClass}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function StatsBar({ onOpenTimeline }) {
  const state = useAppState();
  const dispatch = useDispatch();
  const { currentStatus, activeStatFilter } = state;

  const task = currentStatus?.active_task ?? null;
  const agents = currentStatus?.agents ?? [];

  // Derive counts
  const total = task?.total_tasks ?? agents.length;
  const completed = task?.completed_tasks ?? agents.filter(a => a.status === 'completed').length;
  const failed = task?.failed_tasks ?? agents.filter(a => a.status === 'failed').length;
  const inProgress = agents.filter(a => a.status === 'in_progress').length;
  const pending = agents.filter(a => a.status === 'pending').length;

  // Elapsed — live-updating if the task is still running
  const [elapsed, setElapsed] = useState('—');

  const computeElapsed = useCallback(() => {
    if (!task?.started_at) return '—';
    if (task.completed_at) {
      return calcDuration(task.started_at, task.completed_at);
    }
    return formatElapsed(task.started_at);
  }, [task?.started_at, task?.completed_at]);

  useEffect(() => {
    setElapsed(computeElapsed());

    // Only tick if the task is running (has start but no end)
    if (!task?.started_at || task?.completed_at) return;

    const id = setInterval(() => setElapsed(computeElapsed()), 1000);
    return () => clearInterval(id);
  }, [computeElapsed, task?.started_at, task?.completed_at]);

  function handleFilter(filter) {
    const next = activeStatFilter === filter ? null : filter;
    dispatch({ type: 'SET', key: 'activeStatFilter', value: next });
  }

  function handleElapsedClick() {
    if (typeof onOpenTimeline === 'function') onOpenTimeline();
  }

  return (
    <div className="stats-bar">
      <StatCard
        id="total"
        value={total}
        label="Total"
        numberClass="total"
        isActive={activeStatFilter === 'total'}
        onClick={() => handleFilter('total')}
      />
      <StatCard
        id="completed"
        value={completed}
        label="Completed"
        numberClass="completed"
        isActive={activeStatFilter === 'completed'}
        onClick={() => handleFilter('completed')}
      />
      <StatCard
        id="in_progress"
        value={inProgress}
        label="In Progress"
        numberClass="in-progress"
        isActive={activeStatFilter === 'in_progress'}
        onClick={() => handleFilter('in_progress')}
      />
      <StatCard
        id="failed"
        value={failed}
        label="Failed"
        numberClass="failed"
        isActive={activeStatFilter === 'failed'}
        onClick={() => handleFilter('failed')}
      />
      <StatCard
        id="pending"
        value={pending}
        label="Pending"
        numberClass="pending"
        isActive={activeStatFilter === 'pending'}
        onClick={() => handleFilter('pending')}
      />
      <div
        className={`stat-card${activeStatFilter === 'elapsed' ? ' stat-active' : ''}`}
        onClick={handleElapsedClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleElapsedClick(); }}
      >
        <span className="stat-number total">{elapsed}</span>
        <span className="stat-label">Elapsed</span>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import API_BASE from './config';
import { useAuth } from './AuthContext';
import './Schedule.css';

const HOUR_START = 6;   // 6 AM
const HOUR_END = 23;    // 11 PM
const TOTAL_HOURS = HOUR_END - HOUR_START;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };

const ROLE_COLORS = [
  '#61dafb', '#4caf50', '#ff9800', '#e91e63',
  '#9c27b0', '#00bcd4', '#ff5722', '#8bc34a',
  '#ffc107', '#03a9f4', '#f44336', '#3f51b5',
];

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function minutesToPos(minutes) {
  const startMin = HOUR_START * 60;
  const totalMin = TOTAL_HOURS * 60;
  return Math.max(0, Math.min(100, ((minutes - startMin) / totalMin) * 100));
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toYMD(date) {
  // Use local date parts to avoid UTC-offset shifting the day
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ScheduleTab() {
  const { selectedOrganizationId } = useAuth();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [tooltip, setTooltip] = useState(null);
  const [viewMode, setViewMode] = useState('gantt'); // 'gantt' | 'day'
  const [selectedDay, setSelectedDay] = useState('Mon');

  const token = localStorage.getItem('access_token');

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/schedule/shifts/?week_start=${toYMD(weekStart)}`,
        { headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': selectedOrganizationId } }
      );
      if (!res.ok) throw new Error('Failed to fetch shifts');
      const data = await res.json();
      setShifts(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [weekStart, token, selectedOrganizationId]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  // Build role → color map
  const roleColors = {};
  const roles = [...new Set(shifts.map(s => s.role).filter(Boolean))];
  roles.forEach((role, i) => {
    roleColors[role] = ROLE_COLORS[i % ROLE_COLORS.length];
  });

  // Group shifts by day_label
  const shiftsByDay = {};
  DAYS.forEach(d => { shiftsByDay[d] = []; });
  shifts.forEach(s => {
    if (shiftsByDay[s.day_label]) shiftsByDay[s.day_label].push(s);
  });

  // Unique employees with their job
  const employeeMap = {};
  shifts.forEach(s => {
    if (!employeeMap[s.employee_name]) {
      employeeMap[s.employee_name] = s.primary_job || '';
    }
  });
  const employees = Object.keys(employeeMap).sort();

  const weekDates = DAYS.map((_, i) => addDays(weekStart, i));

  const handlePrevWeek = () => setWeekStart(w => addDays(w, -7));
  const handleNextWeek = () => setWeekStart(w => addDays(w, 7));
  const handleToday = () => setWeekStart(getMondayOfWeek(new Date()));

  const hours = Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_START + i);

  // ─── Gantt (weekly) view ───────────────────────────────────────────
  const renderGantt = () => (
    <div className="gantt-wrapper">
      <div className="gantt-day-headers">
        <div className="gantt-name-col" />
        {DAYS.map((day, i) => (
          <div key={day} className="gantt-day-header">
            <span className="day-abbr">{day}</span>
            <span className="day-date">{formatShortDate(weekDates[i])}</span>
          </div>
        ))}
      </div>

      <div className="gantt-body">
        {employees.length === 0 ? (
          <div className="no-data">No shifts available for this week.</div>
        ) : (
          employees.map(emp => {
            const empShifts = shifts.filter(s => s.employee_name === emp);
            return (
              <div key={emp} className="gantt-row">
                <div className="gantt-name-col" title={`${emp}${employeeMap[emp] ? ' — ' + employeeMap[emp] : ''}`}>
                  <span className="gantt-emp-name">{emp}</span>
                  {employeeMap[emp] && <span className="gantt-emp-job">{employeeMap[emp]}</span>}
                </div>
                {DAYS.map(day => {
                  const dayShifts = empShifts.filter(s => s.day_label === day);
                  return (
                    <div key={day} className="gantt-cell">
                      {dayShifts.map(shift => {
                        const startMin = timeToMinutes(shift.start_time);
                        const endMin = timeToMinutes(shift.end_time);
                        const left = minutesToPos(startMin);
                        const width = minutesToPos(endMin) - left;
                        const color = roleColors[shift.role] || '#61dafb';
                        return (
                          <div
                            key={shift.id}
                            className={`shift-bar${shift.is_closing ? ' closing' : ''}`}
                            style={{ left: `${left}%`, width: `${Math.max(width, 2)}%`, backgroundColor: color }}
                            onMouseEnter={e => setTooltip({ shift, x: e.clientX, y: e.clientY })}
                            onMouseLeave={() => setTooltip(null)}
                          >
                            <span className="shift-bar-label">
                              {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                            </span>
                          </div>
                        );
                      })}
                      {/* Hour grid lines */}
                      {hours.map(h => (
                        <div
                          key={h}
                          className="gantt-gridline"
                          style={{ left: `${minutesToPos(h * 60)}%` }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Time axis */}
      <div className="gantt-time-axis">
        <div className="gantt-name-col" />
        <div className="gantt-time-track">
          {hours.map(h => (
            <div key={h} className="gantt-hour-label" style={{ left: `${minutesToPos(h * 60)}%` }}>
              {h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ─── Day view ────────────────────────────────────────────────────
  const renderDayView = () => {
    const dayShifts = shiftsByDay[selectedDay] || [];

    return (
      <div className="day-view">
        <div className="day-tabs">
          {DAYS.map((day, i) => (
            <button
              key={day}
              className={`day-tab${selectedDay === day ? ' active' : ''}`}
              onClick={() => setSelectedDay(day)}
            >
              <span>{day}</span>
              <span className="day-tab-date">{formatShortDate(weekDates[i])}</span>
            </button>
          ))}
        </div>

        <div className="day-timeline">
          <div className="day-hours">
            {hours.map(h => (
              <div key={h} className="day-hour">
                <span>{h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`}</span>
              </div>
            ))}
          </div>
          <div className="day-shifts">
            {hours.map(h => (
              <div key={h} className="day-hour-row">
                {dayShifts
                  .filter(s => {
                    const startH = Math.floor(timeToMinutes(s.start_time) / 60);
                    return startH === h;
                  })
                  .map(s => {
                    const color = roleColors[s.role] || '#61dafb';
                    return (
                      <div
                        key={s.id}
                        className={`day-shift-card${s.is_closing ? ' closing' : ''}`}
                        style={{ borderLeft: `4px solid ${color}` }}
                        onMouseEnter={e => setTooltip({ shift: s, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span className="day-shift-name">{s.employee_name}</span>
                        <span className="day-shift-time">{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                        {s.role && <span className="day-shift-role" style={{ color }}>{s.role}</span>}
                        {s.is_closing && <span className="closing-badge">Closing</span>}
                      </div>
                    );
                  })}
              </div>
            ))}
            {dayShifts.length === 0 && (
              <div className="no-data">No shifts for {DAY_FULL[selectedDay]}.</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="schedule-tab">
      {/* Header */}
      <div className="schedule-header">
        <div className="schedule-header-left">
          <h2>Schedule</h2>
          <div className="week-nav">
            <button onClick={handlePrevWeek} title="Previous week">‹</button>
            <span className="week-label">
              {formatShortDate(weekStart)} – {formatShortDate(addDays(weekStart, 6))}
            </span>
            <button onClick={handleNextWeek} title="Next week">›</button>
            <button className="today-btn" onClick={handleToday}>Today</button>
          </div>
        </div>

        <div className="schedule-header-right">
          <div className="view-toggle">
            <button
              className={viewMode === 'gantt' ? 'active' : ''}
              onClick={() => setViewMode('gantt')}
            >📊 Weekly</button>
            <button
              className={viewMode === 'day' ? 'active' : ''}
              onClick={() => setViewMode('day')}
            >📅 Day</button>
          </div>

        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="schedule-error">
          <span>⚠️ {error}</span>
        </div>
      )}
      {/* Legend */}
      {roles.length > 0 && (
        <div className="schedule-legend">
          {roles.map(role => (
            <span key={role} className="legend-item">
              <span className="legend-dot" style={{ backgroundColor: roleColors[role] }} />
              {role}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-dot closing-dot" />
            Closing shift
          </span>
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="schedule-loading">Loading shifts…</div>
      ) : (
        <div className="schedule-content">
          {viewMode === 'gantt' ? renderGantt() : renderDayView()}
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="shift-tooltip"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          <strong>{tooltip.shift.employee_name}</strong>
          {tooltip.shift.primary_job && <div style={{color:'#aaa',fontSize:12}}>{tooltip.shift.primary_job}</div>}
          <div>{formatTime(tooltip.shift.start_time)} – {formatTime(tooltip.shift.end_time)}</div>
          {tooltip.shift.role && <div>Role: {tooltip.shift.role}</div>}
          {tooltip.shift.is_closing && <div className="tooltip-closing">⭐ Closing</div>}
        </div>
      )}
    </div>
  );
}

export default ScheduleTab;

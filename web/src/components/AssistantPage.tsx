import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Todo {
  id: string;
  text: string;
  priority: "high" | "medium" | "low";
  done: boolean;
  createdAt: string;
  doneAt?: string;
  category?: string;
}

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface Reminder {
  id: string;
  text: string;
  triggerAt: string;
  fired: boolean;
  createdAt: string;
}

interface EmailAccount {
  id: string;
  name: string;
  email: string;
  imap: { host: string; port: number; secure: boolean };
  smtp: { host: string; port: number; secure: boolean };
}

interface EmailSummary {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  seen: boolean;
  accountId: string;
  accountName: string;
}

interface EmailFull extends EmailSummary {
  textBody: string;
}

type TabId = "todos" | "notes" | "reminders" | "email";

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400 bg-red-500/10 border-red-500/20",
  medium: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  low: "text-green-400 bg-green-500/10 border-green-500/20",
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function AssistantPage() {
  const [activeTab, setActiveTab] = useState<TabId>("todos");
  const [refreshKey, setRefreshKey] = useState(0);

  function refresh() { setRefreshKey((k) => k + 1); }

  const tabs: { id: TabId; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "notes", label: "Notes" },
    { id: "reminders", label: "Reminders" },
    { id: "email", label: "Email" },
  ];

  return (
    <div className="h-full flex flex-col bg-cc-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-cc-border px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-cc-fg">Assistant</h1>
            <p className="text-xs text-cc-muted mt-0.5">Personal todos, notes & reminders — managed by Gemini Live</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "bg-cc-accent text-white"
                  : "text-cc-muted hover:text-cc-fg hover:bg-cc-hover"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "todos" && <TodosTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "notes" && <NotesTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "reminders" && <RemindersTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "email" && <EmailTab refreshKey={refreshKey} onRefresh={refresh} />}
      </div>
    </div>
  );
}

// ─── Todos Tab ──────────────────────────────────────────────────────────────

function TodosTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [newText, setNewText] = useState("");
  const [newPriority, setNewPriority] = useState<"high" | "medium" | "low">("medium");
  const [newCategory, setNewCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filterParam: { done?: boolean } = {};
      if (filter === "active") filterParam.done = false;
      if (filter === "done") filterParam.done = true;
      const res = await api.listTodos(filterParam);
      setTodos(res.todos);
    } catch { /* ignore */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim()) return;
    setAdding(true);
    try {
      await api.addTodo({ text: newText.trim(), priority: newPriority, category: newCategory.trim() || undefined });
      setNewText("");
      setNewCategory("");
      onRefresh();
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function handleToggle(todo: Todo) {
    try {
      await api.updateTodo(todo.id, { done: !todo.done });
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteTodo(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleEditSave(id: string) {
    if (!editText.trim()) return;
    try {
      await api.updateTodo(id, { text: editText.trim() });
      setEditingId(null);
      onRefresh();
    } catch { /* ignore */ }
  }

  const activeTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);
  const sortedTodos = filter === "all" ? [...activeTodos, ...doneTodos] : todos;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {/* Add form */}
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a todo..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent"
        />
        <div className="flex gap-2">
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as Todo["priority"])}
            className="px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none cursor-pointer"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category"
            className="w-24 px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !newText.trim()}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
          >
            Add
          </button>
        </div>
      </form>

      {/* Filter */}
      <div className="flex gap-1">
        {(["all", "active", "done"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
              filter === f ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:text-cc-fg"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : sortedTodos.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {filter === "done" ? "No completed todos" : filter === "active" ? "All done!" : "No todos yet. Add one above or ask Gemini Live."}
        </div>
      ) : (
        <div className="space-y-1">
          {sortedTodos.map((todo) => (
            <div
              key={todo.id}
              className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                todo.done ? "bg-cc-bg border-cc-border/50 opacity-60" : "bg-cc-card border-cc-border hover:border-cc-border-hover"
              }`}
            >
              <button
                type="button"
                onClick={() => handleToggle(todo)}
                className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center cursor-pointer transition-colors ${
                  todo.done ? "bg-cc-accent border-cc-accent" : "border-cc-muted hover:border-cc-accent"
                }`}
              >
                {todo.done && (
                  <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                {editingId === todo.id ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(todo.id); if (e.key === "Escape") setEditingId(null); }}
                      className="flex-1 px-2 py-1 text-sm bg-cc-input border border-cc-border rounded text-cc-fg focus:outline-none focus:border-cc-accent"
                      autoFocus
                    />
                    <button type="button" onClick={() => handleEditSave(todo.id)} className="text-xs text-cc-accent hover:underline cursor-pointer">Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs text-cc-muted hover:underline cursor-pointer">Cancel</button>
                  </div>
                ) : (
                  <span
                    className={`text-sm ${todo.done ? "line-through text-cc-muted" : "text-cc-fg"}`}
                    onDoubleClick={() => { setEditingId(todo.id); setEditText(todo.text); }}
                  >
                    {todo.text}
                  </span>
                )}

                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[todo.priority]}`}>
                    {todo.priority}
                  </span>
                  {todo.category && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">
                      {todo.category}
                    </span>
                  )}
                  <span className="text-[10px] text-cc-muted">{relativeTime(todo.createdAt)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleDelete(todo.id)}
                className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1"
                title="Delete"
              >
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                  <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z" />
                  <path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Notes Tab ──────────────────────────────────────────────────────────────

function NotesTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listNotes(search || undefined);
      setNotes(res.notes);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  function openNew() {
    setSelectedNote(null);
    setEditTitle("");
    setEditContent("");
    setEditTags("");
    setShowEditor(true);
  }

  function openEdit(note: Note) {
    setSelectedNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditTags(note.tags.join(", "));
    setShowEditor(true);
  }

  async function handleSave() {
    if (!editTitle.trim()) return;
    setSaving(true);
    const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (selectedNote) {
        await api.updateNote(selectedNote.id, { title: editTitle.trim(), content: editContent, tags });
      } else {
        await api.addNote({ title: editTitle.trim(), content: editContent, tags });
      }
      setShowEditor(false);
      onRefresh();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteNote(id);
      if (selectedNote?.id === id) setShowEditor(false);
      onRefresh();
    } catch { /* ignore */ }
  }

  if (showEditor) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowEditor(false)}
            className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
            Back
          </button>
          <span className="text-xs text-cc-muted">{selectedNote ? "Edit Note" : "New Note"}</span>
        </div>

        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="Title"
          className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent"
          autoFocus
        />

        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="Write your note..."
          rows={12}
          className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent resize-y font-mono"
        />

        <input
          type="text"
          value={editTags}
          onChange={(e) => setEditTags(e.target.value)}
          placeholder="Tags (comma separated)"
          className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !editTitle.trim()}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setShowEditor(false)}
            className="px-4 py-2 text-xs text-cc-muted hover:text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {/* Search + New */}
      <div className="flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notes..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent"
        />
        <button
          type="button"
          onClick={openNew}
          className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 cursor-pointer"
        >
          New Note
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : notes.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {search ? "No matching notes" : "No notes yet. Create one or ask Gemini Live."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="group p-4 rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors cursor-pointer"
              onClick={() => openEdit(note)}
            >
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-medium text-cc-fg truncate flex-1">{note.title}</h3>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(note.id); }}
                  className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1 -mr-1 -mt-1"
                  title="Delete"
                >
                  <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
                    <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                  </svg>
                </button>
              </div>
              {note.content && (
                <p className="text-xs text-cc-muted mt-1 line-clamp-3">{note.content}</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                {note.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">
                    {tag}
                  </span>
                ))}
                <span className="text-[10px] text-cc-muted ml-auto">{relativeTime(note.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reminders Tab ──────────────────────────────────────────────────────────

function RemindersTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listReminders(showAll);
      setReminders(res.reminders);
    } catch { /* ignore */ }
    setLoading(false);
  }, [showAll]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newText.trim() || !newDate || !newTime) return;
    setAdding(true);
    try {
      const triggerAt = new Date(`${newDate}T${newTime}`).toISOString();
      await api.addReminder({ text: newText.trim(), triggerAt });
      setNewText("");
      setNewDate("");
      setNewTime("");
      onRefresh();
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteReminder(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  const now = new Date();
  const upcoming = reminders.filter((r) => !r.fired && new Date(r.triggerAt) > now);
  const overdue = reminders.filter((r) => !r.fired && new Date(r.triggerAt) <= now);
  const fired = reminders.filter((r) => r.fired);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {/* Add form */}
      <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Remind me to..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent"
        />
        <div className="flex gap-2">
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none"
          />
          <input
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !newText.trim() || !newDate || !newTime}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
          >
            Add
          </button>
        </div>
      </form>

      {/* Show all toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className={`text-xs cursor-pointer ${showAll ? "text-cc-accent" : "text-cc-muted hover:text-cc-fg"}`}
        >
          {showAll ? "Hide fired" : "Show all"}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : reminders.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          No reminders yet. Add one above or ask Gemini Live.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Overdue */}
          {overdue.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-red-400 mb-2">Overdue</h3>
              <div className="space-y-1">
                {overdue.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onDelete={handleDelete} isOverdue />
                ))}
              </div>
            </div>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-cc-fg mb-2">Upcoming</h3>
              <div className="space-y-1">
                {upcoming.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {/* Fired */}
          {showAll && fired.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-cc-muted mb-2">Completed</h3>
              <div className="space-y-1">
                {fired.map((r) => (
                  <ReminderRow key={r.id} reminder={r} onDelete={handleDelete} isFired />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderRow({ reminder, onDelete, isOverdue, isFired }: {
  reminder: Reminder;
  onDelete: (id: string) => void;
  isOverdue?: boolean;
  isFired?: boolean;
}) {
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
        isFired ? "bg-cc-bg border-cc-border/50 opacity-60" :
        isOverdue ? "bg-red-500/5 border-red-500/20" :
        "bg-cc-card border-cc-border hover:border-cc-border-hover"
      }`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${
        isFired ? "bg-cc-muted" : isOverdue ? "bg-red-400 animate-pulse" : "bg-cc-accent"
      }`} />

      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isFired ? "line-through text-cc-muted" : "text-cc-fg"}`}>
          {reminder.text}
        </span>
        <div className="text-[10px] text-cc-muted mt-0.5">
          {formatDateTime(reminder.triggerAt)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onDelete(reminder.id)}
        className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1"
        title="Delete"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
          <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z" />
          <path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z" />
        </svg>
      </button>
    </div>
  );
}

// ─── Email Tab ──────────────────────────────────────────────────────────────

const COMMON_PROVIDERS: Record<string, { imap: { host: string; port: number; secure: boolean }; smtp: { host: string; port: number; secure: boolean } }> = {
  gmail: { imap: { host: "imap.gmail.com", port: 993, secure: true }, smtp: { host: "smtp.gmail.com", port: 465, secure: true } },
  outlook: { imap: { host: "outlook.office365.com", port: 993, secure: true }, smtp: { host: "smtp.office365.com", port: 587, secure: false } },
  icloud: { imap: { host: "imap.mail.me.com", port: 993, secure: true }, smtp: { host: "smtp.mail.me.com", port: 587, secure: false } },
  yahoo: { imap: { host: "imap.mail.yahoo.com", port: 993, secure: true }, smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true } },
};

function EmailTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"accounts" | "inbox" | "read" | "compose" | "add-account">("accounts");
  const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null);
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<EmailFull | null>(null);
  const [unreadSummary, setUnreadSummary] = useState<Array<{ accountName: string; email: string; unread: number }>>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [message, setMessage] = useState("");

  // Add account form
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addUser, setAddUser] = useState("");
  const [addPass, setAddPass] = useState("");
  const [addProvider, setAddProvider] = useState<string>("gmail");
  const [addImapHost, setAddImapHost] = useState("imap.gmail.com");
  const [addImapPort, setAddImapPort] = useState(993);
  const [addSmtpHost, setAddSmtpHost] = useState("smtp.gmail.com");
  const [addSmtpPort, setAddSmtpPort] = useState(465);
  const [addTesting, setAddTesting] = useState(false);

  // Compose form
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [replyUid, setReplyUid] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, unreadRes] = await Promise.allSettled([
        api.listEmailAccounts(),
        api.getUnreadSummary(),
      ]);
      if (accRes.status === "fulfilled") setAccounts(accRes.value.accounts || []);
      if (unreadRes.status === "fulfilled") setUnreadSummary(unreadRes.value.summary || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  function selectProvider(p: string) {
    setAddProvider(p);
    const cfg = COMMON_PROVIDERS[p];
    if (cfg) {
      setAddImapHost(cfg.imap.host);
      setAddImapPort(cfg.imap.port);
      setAddSmtpHost(cfg.smtp.host);
      setAddSmtpPort(cfg.smtp.port);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!addName.trim() || !addEmail.trim() || !addUser.trim() || !addPass.trim()) return;
    setAddTesting(true);
    try {
      await api.addEmailAccount({
        name: addName.trim(),
        email: addEmail.trim(),
        imap: { host: addImapHost, port: addImapPort, secure: addImapPort === 993 },
        smtp: { host: addSmtpHost, port: addSmtpPort, secure: addSmtpPort === 465 },
        auth: { user: addUser.trim(), pass: addPass },
      });
      setAddName(""); setAddEmail(""); setAddUser(""); setAddPass("");
      setView("accounts");
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to add account");
    }
    setAddTesting(false);
  }

  async function handleDeleteAccount(id: string) {
    try {
      await api.deleteEmailAccount(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleTestAccount(id: string) {
    setMessage("Testing connection...");
    try {
      const res = await api.testEmailAccount(id);
      setMessage(res.ok ? "Connection successful!" : `Failed: ${res.error}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Test failed");
    }
  }

  async function openInbox(account: EmailAccount) {
    setSelectedAccount(account);
    setView("inbox");
    setLoadingEmails(true);
    try {
      const res = await api.listEmails(account.id, { limit: 20 });
      setEmails(res.emails || []);
    } catch { setEmails([]); }
    setLoadingEmails(false);
  }

  async function openEmail(email: EmailSummary) {
    setLoadingEmails(true);
    try {
      const full = await api.readEmail(email.accountId, email.uid);
      setSelectedEmail(full);
      setView("read");
    } catch { /* ignore */ }
    setLoadingEmails(false);
  }

  function openCompose(replyTo?: EmailFull) {
    setSelectedAccount(selectedAccount);
    if (replyTo) {
      setReplyUid(replyTo.uid);
      setComposeTo(replyTo.from);
      setComposeSubject(replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`);
      setComposeBody("");
    } else {
      setReplyUid(null);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    }
    setView("compose");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccount || !composeTo.trim() || !composeBody.trim()) return;
    setComposeSending(true);
    try {
      if (replyUid) {
        await api.replyToEmail(selectedAccount.id, { uid: replyUid, body: composeBody });
      } else {
        await api.sendEmailMessage(selectedAccount.id, { to: composeTo, subject: composeSubject, body: composeBody });
      }
      setMessage("Email sent!");
      setView("inbox");
      openInbox(selectedAccount);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to send");
    }
    setComposeSending(false);
  }

  // Clear message after 3s
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 3000);
      return () => clearTimeout(t);
    }
  }, [message]);

  // ─── Add Account View ─────────────────────────────────────────────
  if (view === "add-account") {
    return (
      <div className="p-4 sm:p-6 max-w-2xl space-y-4">
        <button type="button" onClick={() => setView("accounts")} className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1">
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
          Back
        </button>
        <h3 className="text-sm font-medium text-cc-fg">Add Email Account</h3>

        <form onSubmit={handleAddAccount} className="space-y-3">
          {/* Provider preset */}
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Provider</label>
            <div className="flex gap-1 flex-wrap">
              {Object.keys(COMMON_PROVIDERS).map((p) => (
                <button key={p} type="button" onClick={() => selectProvider(p)}
                  className={`px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${addProvider === p ? "bg-cc-accent text-white" : "bg-cc-hover text-cc-muted hover:text-cc-fg"}`}
                >{p.charAt(0).toUpperCase() + p.slice(1)}</button>
              ))}
              <button type="button" onClick={() => setAddProvider("custom")}
                className={`px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${addProvider === "custom" ? "bg-cc-accent text-white" : "bg-cc-hover text-cc-muted hover:text-cc-fg"}`}
              >Custom</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Display Name</label>
              <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Work" className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            </div>
            <div>
              <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Email Address</label>
              <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="user@example.com" className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Username</label>
              <input type="text" value={addUser} onChange={(e) => setAddUser(e.target.value)} placeholder="user@example.com" className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            </div>
            <div>
              <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Password / App Password</label>
              <input type="password" value={addPass} onChange={(e) => setAddPass(e.target.value)} placeholder="App-specific password" className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            </div>
          </div>

          {addProvider === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">IMAP Host</label>
                <input type="text" value={addImapHost} onChange={(e) => setAddImapHost(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">IMAP Port</label>
                <input type="number" value={addImapPort} onChange={(e) => setAddImapPort(Number(e.target.value))} className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">SMTP Host</label>
                <input type="text" value={addSmtpHost} onChange={(e) => setAddSmtpHost(e.target.value)} className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">SMTP Port</label>
                <input type="number" value={addSmtpPort} onChange={(e) => setAddSmtpPort(Number(e.target.value))} className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none" />
              </div>
            </div>
          )}

          <p className="text-[10px] text-cc-muted">For Gmail/iCloud, use an App Password (not your regular password). Go to your account security settings to generate one.</p>

          <button type="submit" disabled={addTesting || !addName.trim() || !addEmail.trim() || !addUser.trim() || !addPass.trim()}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
          >{addTesting ? "Adding..." : "Add Account"}</button>
        </form>
      </div>
    );
  }

  // ─── Compose View ─────────────────────────────────────────────────
  if (view === "compose" && selectedAccount) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl space-y-4">
        <button type="button" onClick={() => setView(selectedEmail ? "read" : "inbox")} className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1">
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
          Back
        </button>
        <h3 className="text-sm font-medium text-cc-fg">{replyUid ? "Reply" : "New Email"}</h3>
        {message && <div className="text-xs text-cc-accent">{message}</div>}

        <form onSubmit={handleSend} className="space-y-3">
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">From</label>
            <div className="text-xs text-cc-fg">{selectedAccount.name} &lt;{selectedAccount.email}&gt;</div>
          </div>
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">To</label>
            <input type="text" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="recipient@example.com"
              className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Subject</label>
            <input type="text" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} placeholder="Subject"
              className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          <div>
            <label className="text-[10px] text-cc-muted uppercase tracking-wider block mb-1">Message</label>
            <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={10} placeholder="Write your message..."
              className="w-full px-2 py-1.5 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent resize-y font-mono" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={composeSending || !composeTo.trim() || !composeBody.trim()}
              className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
            >{composeSending ? "Sending..." : "Send"}</button>
          </div>
        </form>
      </div>
    );
  }

  // ─── Read Email View ──────────────────────────────────────────────
  if (view === "read" && selectedEmail && selectedAccount) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl space-y-4">
        <button type="button" onClick={() => { setView("inbox"); setSelectedEmail(null); }} className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1">
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
          Back to Inbox
        </button>

        <div className="border border-cc-border rounded-lg p-4 bg-cc-card space-y-3">
          <h3 className="text-sm font-medium text-cc-fg">{selectedEmail.subject}</h3>
          <div className="flex items-center justify-between text-[10px] text-cc-muted">
            <span>From: {selectedEmail.from}</span>
            <span>{formatDateTime(selectedEmail.date)}</span>
          </div>
          <div className="text-[10px] text-cc-muted">To: {selectedEmail.to}</div>
          <div className="border-t border-cc-border pt-3">
            <pre className="text-xs text-cc-fg whitespace-pre-wrap font-mono leading-relaxed">{selectedEmail.textBody}</pre>
          </div>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => openCompose(selectedEmail)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent/10 text-cc-accent border border-cc-accent/30 hover:bg-cc-accent/20 cursor-pointer"
          >Reply</button>
          <button type="button" onClick={() => openCompose()}
            className="px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer"
          >New Email</button>
        </div>
      </div>
    );
  }

  // ─── Inbox View ───────────────────────────────────────────────────
  if (view === "inbox" && selectedAccount) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => { setView("accounts"); setSelectedAccount(null); }} className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1">
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-cc-fg font-medium">{selectedAccount.name}</span>
            <span className="text-[10px] text-cc-muted">{selectedAccount.email}</span>
          </div>
          <button type="button" onClick={() => openCompose()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 cursor-pointer"
          >Compose</button>
        </div>

        {loadingEmails ? (
          <div className="text-sm text-cc-muted py-8 text-center">Loading emails...</div>
        ) : emails.length === 0 ? (
          <div className="text-sm text-cc-muted py-8 text-center">No emails found.</div>
        ) : (
          <div className="space-y-0.5">
            {emails.map((email) => (
              <button key={email.uid} type="button" onClick={() => openEmail(email)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                  email.seen ? "bg-cc-bg border-cc-border/50" : "bg-cc-card border-cc-border hover:border-cc-border-hover"
                }`}
              >
                <div className="flex items-center gap-2">
                  {!email.seen && <div className="w-1.5 h-1.5 rounded-full bg-cc-accent shrink-0" />}
                  <span className={`text-xs truncate flex-1 ${email.seen ? "text-cc-muted" : "text-cc-fg font-medium"}`}>{email.from}</span>
                  <span className="text-[10px] text-cc-muted shrink-0">{relativeTime(email.date)}</span>
                </div>
                <div className={`text-xs truncate mt-0.5 ${email.seen ? "text-cc-muted" : "text-cc-fg"}`}>{email.subject}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Accounts Overview ────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {message && <div className="text-xs px-3 py-2 rounded-md bg-cc-accent/10 text-cc-accent">{message}</div>}

      <div className="flex items-center justify-between">
        <span className="text-xs text-cc-muted">
          {accounts.length === 0 ? "No email accounts configured." : `${accounts.length} account${accounts.length > 1 ? "s" : ""}`}
        </span>
        <button type="button" onClick={() => setView("add-account")}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 cursor-pointer"
        >Add Account</button>
      </div>

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => {
            const unread = unreadSummary.find((u) => u.email === account.email);
            return (
              <div key={account.id} className="group flex items-center gap-3 px-4 py-3 rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors">
                <div className="w-8 h-8 rounded-full bg-cc-accent/10 text-cc-accent flex items-center justify-center text-sm font-bold shrink-0">
                  {account.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openInbox(account)}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-cc-fg">{account.name}</span>
                    {unread && unread.unread > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cc-accent text-white font-medium">{unread.unread}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-cc-muted truncate">{account.email}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" onClick={() => openInbox(account)} className="px-2 py-1 text-[10px] text-cc-accent hover:underline cursor-pointer">Open</button>
                  <button type="button" onClick={() => handleTestAccount(account.id)} className="px-2 py-1 text-[10px] text-cc-muted hover:text-cc-fg cursor-pointer">Test</button>
                  <button type="button" onClick={() => handleDeleteAccount(account.id)} className="px-2 py-1 text-[10px] text-cc-muted hover:text-red-400 cursor-pointer">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {accounts.length === 0 && !loading && (
        <div className="text-center py-4">
          <p className="text-xs text-cc-muted">Add an email account to read, send, and manage emails.</p>
          <p className="text-xs text-cc-muted mt-1">Gemini Live can also manage your emails via voice.</p>
        </div>
      )}
    </div>
  );
}

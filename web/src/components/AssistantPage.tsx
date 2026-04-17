import { useState, useEffect, useCallback } from "react";
import { api, documentsApi, templatesApi, timeApi, newsApi } from "../api.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Todo {
  id: string;
  text: string;
  priority: "high" | "medium" | "low";
  done: boolean;
  createdAt: string;
  doneAt?: string;
  category?: string;
  delegatedTo?: string;
  dueDate?: string;
  followUpDate?: string;
  project?: string;
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
  calendarEventUid?: string;
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

interface Contact {
  id: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags: string[];
  lastContactDate?: string;
  interactions: Array<{ date: string; type: string; summary: string }>;
  createdAt: string;
  updatedAt: string;
}

interface Decision {
  id: string;
  title: string;
  context: string;
  decision: string;
  alternatives: string[];
  reasoning: string;
  tags: string[];
  createdAt: string;
}

type TabId = "todos" | "notes" | "reminders" | "email" | "contacts" | "decisions" | "documents" | "templates" | "time" | "news";

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
    { id: "contacts", label: "Contacts" },
    { id: "decisions", label: "Decisions" },
    { id: "documents", label: "Documents" },
    { id: "templates", label: "Templates" },
    { id: "time", label: "Time" },
    { id: "news", label: "News" },
  ];

  return (
    <div className="h-full flex flex-col bg-cc-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-cc-border">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-8 py-4">
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-8 py-6 pb-safe">
        {activeTab === "todos" && <TodosTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "notes" && <NotesTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "reminders" && <RemindersTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "email" && <EmailTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "contacts" && <ContactsTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "decisions" && <DecisionsTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "documents" && <DocumentsTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "templates" && <TemplatesTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "time" && <TimeTab refreshKey={refreshKey} onRefresh={refresh} />}
        {activeTab === "news" && <NewsTab refreshKey={refreshKey} onRefresh={refresh} />}
        </div>
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
  const [projectFilter, setProjectFilter] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filterParam: { done?: boolean } = {};
      if (filter === "active") filterParam.done = false;
      if (filter === "done") filterParam.done = true;
      const res = await api.listTodos(filterParam);
      setTodos(res.todos as Todo[]);
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

  const projectFiltered = projectFilter ? todos.filter((t) => t.project === projectFilter) : todos;
  const activeTodos = projectFiltered.filter((t) => !t.done);
  const doneTodos = projectFiltered.filter((t) => t.done);
  const sortedTodos = filter === "all" ? [...activeTodos, ...doneTodos] : projectFiltered;
  const uniqueProjects = [...new Set(todos.map((t) => t.project).filter(Boolean))] as string[];

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
      <div className="flex items-center gap-2">
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
        {uniqueProjects.length > 0 && (
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2 py-1 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none cursor-pointer"
          >
            <option value="">All projects</option>
            {uniqueProjects.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
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
                  {todo.project && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                      {todo.project}
                    </span>
                  )}
                  {todo.delegatedTo && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      {todo.delegatedTo}{todo.dueDate ? ` \u00b7 ${todo.dueDate}` : ""}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

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

  function startEdit(r: Reminder) {
    setEditingId(r.id);
    setEditText(r.text);
    const d = new Date(r.triggerAt);
    setEditDate(d.toISOString().slice(0, 10));
    setEditTime(d.toTimeString().slice(0, 5));
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId || !editText.trim() || !editDate || !editTime) return;
    try {
      const triggerAt = new Date(`${editDate}T${editTime}`).toISOString();
      await api.updateReminder(editingId, { text: editText.trim(), triggerAt });
      setEditingId(null);
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

      {/* Edit form */}
      {editingId && (
        <form onSubmit={handleEdit} className="flex flex-col sm:flex-row gap-2 p-3 bg-cc-accent/5 border border-cc-accent/20 rounded-lg">
          <input
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-accent"
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none"
            />
            <input
              type="time"
              value={editTime}
              onChange={(e) => setEditTime(e.target.value)}
              className="px-2 py-2 text-xs bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none"
            />
            <button
              type="submit"
              disabled={!editText.trim() || !editDate || !editTime}
              className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="px-3 py-2 text-xs font-medium rounded-md text-cc-muted hover:text-cc-fg border border-cc-border cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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
                  <ReminderRow key={r.id} reminder={r} onDelete={handleDelete} onEdit={startEdit} isOverdue />
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
                  <ReminderRow key={r.id} reminder={r} onDelete={handleDelete} onEdit={startEdit} />
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

function ReminderRow({ reminder, onDelete, onEdit, isOverdue, isFired }: {
  reminder: Reminder;
  onDelete: (id: string) => void;
  onEdit?: (r: Reminder) => void;
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
          {reminder.calendarEventUid && (
            <span className="inline-flex items-center gap-0.5 text-cc-accent ml-1" title="Synced to calendar">
              <svg viewBox="0 0 16 16" className="w-2.5 h-2.5" fill="currentColor">
                <path d="M4.5 0a.5.5 0 01.5.5V1h6V.5a.5.5 0 011 0V1h1.5A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11A1.5 1.5 0 012.5 1H4V.5a.5.5 0 01.5-.5zM2 5v8.5a.5.5 0 00.5.5h11a.5.5 0 00.5-.5V5H2z" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {!isFired && onEdit && (
        <button
          type="button"
          onClick={() => onEdit(reminder)}
          className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-cc-accent transition-opacity cursor-pointer p-1"
          title="Edit"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
            <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zM11.189 3.07l1.74 1.74 1.131-1.131a.25.25 0 000-.354L12.974 2.24a.25.25 0 00-.354 0L11.49 3.07z" />
          </svg>
        </button>
      )}

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

// ─── Contacts Tab ────────────────────────────────────────────────────────────

function ContactsTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editName, setEditName] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listCrmContacts(search || undefined);
      setContacts(res.contacts);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  function openNew() {
    setEditContact(null);
    setEditName(""); setEditCompany(""); setEditEmail(""); setEditPhone(""); setEditNotes(""); setEditTags("");
    setShowEditor(true);
  }

  function openEdit(c: Contact) {
    setEditContact(c);
    setEditName(c.name);
    setEditCompany(c.company || "");
    setEditEmail(c.email || "");
    setEditPhone(c.phone || "");
    setEditNotes(c.notes || "");
    setEditTags(c.tags.join(", "));
    setShowEditor(true);
  }

  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (editContact) {
        await api.updateCrmContact(editContact.id, {
          name: editName.trim(), company: editCompany.trim() || undefined,
          email: editEmail.trim() || undefined, phone: editPhone.trim() || undefined,
          notes: editNotes, tags,
        });
      } else {
        await api.addCrmContact({
          name: editName.trim(), company: editCompany.trim() || undefined,
          email: editEmail.trim() || undefined, phone: editPhone.trim() || undefined,
          notes: editNotes, tags,
        });
      }
      setShowEditor(false);
      onRefresh();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteCrmContact(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  if (showEditor) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setShowEditor(false)}
            className="text-xs text-cc-muted hover:text-cc-fg cursor-pointer flex items-center gap-1">
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor"><path fillRule="evenodd" d="M11.354 1.646a.5.5 0 010 .708L5.707 8l5.647 5.646a.5.5 0 01-.708.708l-6-6a.5.5 0 010-.708l6-6a.5.5 0 01.708 0z" /></svg>
            Back
          </button>
          <span className="text-xs text-cc-muted">{editContact ? "Edit Contact" : "New Contact"}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name *"
            className="col-span-2 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" autoFocus />
          <input type="text" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} placeholder="Company"
            className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Email"
            className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Phone"
            className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <input type="text" value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Tags (comma separated)"
            className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
        </div>

        <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Notes..."
          rows={4} className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent resize-y" />

        <div className="flex gap-2">
          <button type="button" onClick={handleSave} disabled={saving || !editName.trim()}
            className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 disabled:opacity-50 cursor-pointer">
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" onClick={() => setShowEditor(false)}
            className="px-4 py-2 text-xs text-cc-muted hover:text-cc-fg rounded-md hover:bg-cc-hover cursor-pointer">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
        <button type="button" onClick={openNew}
          className="px-4 py-2 text-xs font-medium rounded-md bg-cc-accent text-white hover:bg-cc-accent/80 cursor-pointer">
          New Contact
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : contacts.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {search ? "No matching contacts" : "No contacts yet. Add one or ask Hank."}
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="group rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors">
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                <div className="w-8 h-8 rounded-full bg-cc-accent/20 text-cc-accent flex items-center justify-center text-xs font-medium shrink-0">
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-cc-fg truncate">{c.name}</span>
                    {c.company && <span className="text-xs text-cc-muted truncate">{c.company}</span>}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-cc-muted mt-0.5">
                    {c.email && <span>{c.email}</span>}
                    {c.phone && <span>{c.phone}</span>}
                    {c.lastContactDate && <span>Last: {relativeTime(c.lastContactDate)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                    className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-cc-accent transition-opacity cursor-pointer p-1" title="Edit">
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zM11.189 3.07l1.74 1.74 1.131-1.131a.25.25 0 000-.354L12.974 2.24a.25.25 0 00-.354 0L11.49 3.07z" />
                    </svg>
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                    className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1" title="Delete">
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                      <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z" />
                      <path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z" />
                    </svg>
                  </button>
                </div>
              </div>

              {expandedId === c.id && (
                <div className="px-4 pb-3 border-t border-cc-border/50 pt-3 space-y-3">
                  {c.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {c.tags.map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">{tag}</span>
                      ))}
                    </div>
                  )}
                  {c.notes && (
                    <div>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Notes</h4>
                      <p className="text-xs text-cc-fg whitespace-pre-wrap">{c.notes}</p>
                    </div>
                  )}
                  {c.interactions.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Interactions</h4>
                      <div className="space-y-1">
                        {c.interactions.slice().reverse().map((i, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-xs">
                            <span className="text-cc-muted shrink-0">{i.date.slice(0, 10)}</span>
                            <span className={`px-1 py-0.5 rounded text-[10px] shrink-0 ${
                              i.type === "call" ? "bg-blue-500/10 text-blue-400" :
                              i.type === "email" ? "bg-green-500/10 text-green-400" :
                              i.type === "meeting" ? "bg-purple-500/10 text-purple-400" :
                              "bg-cc-hover text-cc-muted"
                            }`}>{i.type}</span>
                            <span className="text-cc-fg">{i.summary}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Decisions Tab ───────────────────────────────────────────────────────────

function DecisionsTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDecisions(search || undefined);
      setDecisions(res.decisions);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleDelete(id: string) {
    try {
      await api.deleteDecision(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search decisions..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
      </div>

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : decisions.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {search ? "No matching decisions" : "No decisions logged yet. Hank will record decisions from conversations."}
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((d) => (
            <div key={d.id} className="group rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors">
              <div className="flex items-start gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-cc-fg">{d.title}</h3>
                  <p className="text-xs text-cc-muted mt-1 line-clamp-2">{d.decision}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {d.tags.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">{tag}</span>
                    ))}
                    <span className="text-[10px] text-cc-muted ml-auto">{relativeTime(d.createdAt)}</span>
                  </div>
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                  className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1 shrink-0" title="Delete">
                  <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                  </svg>
                </button>
              </div>

              {expandedId === d.id && (
                <div className="px-4 pb-3 border-t border-cc-border/50 pt-3 space-y-3">
                  {d.context && (
                    <div>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Context</h4>
                      <p className="text-xs text-cc-fg whitespace-pre-wrap">{d.context}</p>
                    </div>
                  )}
                  {d.alternatives.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Alternatives Considered</h4>
                      <ul className="text-xs text-cc-fg space-y-0.5">
                        {d.alternatives.map((alt, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-cc-muted">-</span>
                            <span>{alt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {d.reasoning && (
                    <div>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Reasoning</h4>
                      <p className="text-xs text-cc-fg whitespace-pre-wrap">{d.reasoning}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Documents Tab ─────────────────────────────────────────────────────────

interface Document {
  id: string;
  title: string;
  fileType: string;
  size: number;
  folder: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  summary?: string;
}

function DocumentsTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [folders, setFolders] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newFileType, setNewFileType] = useState("markdown");
  const [newFolder, setNewFolder] = useState("");
  const [newTags, setNewTags] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (search) {
        const res = await documentsApi.search(search);
        setDocuments(res.documents as Document[]);
      } else {
        const res = await documentsApi.list(folderFilter || undefined);
        setDocuments(res.documents);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, folderFilter]);

  const loadFolders = useCallback(async () => {
    try {
      const res = await documentsApi.folders();
      setFolders(res.folders);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setAdding(true);
    try {
      await documentsApi.create({
        title: newTitle.trim(),
        content: newContent,
        fileType: newFileType,
        folder: newFolder.trim() || undefined,
        tags: newTags ? newTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      });
      setNewTitle(""); setNewContent(""); setNewFileType("markdown"); setNewFolder(""); setNewTags("");
      setShowForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    try {
      await documentsApi.delete(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  const FILE_TYPE_COLORS: Record<string, string> = {
    markdown: "text-blue-400 bg-blue-500/10",
    text: "text-gray-400 bg-gray-500/10",
    json: "text-yellow-400 bg-yellow-500/10",
    csv: "text-green-400 bg-green-500/10",
    html: "text-orange-400 bg-orange-500/10",
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search documents..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
        <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-accent cursor-pointer">
          <option value="">All folders</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="button" onClick={() => setShowForm(!showForm)}
          className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 transition-colors cursor-pointer shrink-0">
          + New
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-3">
          <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Document title"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Document content..."
            rows={6} className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent resize-y" />
          <div className="flex gap-2">
            <select value={newFileType} onChange={(e) => setNewFileType(e.target.value)}
              className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-accent cursor-pointer">
              <option value="markdown">Markdown</option>
              <option value="text">Text</option>
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
              <option value="html">HTML</option>
            </select>
            <input type="text" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Folder (optional)"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            <input type="text" value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="Tags (comma-sep)"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={adding || !newTitle.trim() || !newContent.trim()}
              className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 disabled:opacity-50 transition-colors cursor-pointer">
              {adding ? "Saving..." : "Save Document"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {search || folderFilter ? "No matching documents" : "No documents yet. Click + New to create one."}
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="group flex items-start gap-3 rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-cc-fg truncate">{doc.title}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${FILE_TYPE_COLORS[doc.fileType] || "text-cc-muted bg-cc-hover"}`}>
                    {doc.fileType}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  {doc.folder && <span className="text-[10px] text-cc-muted">{doc.folder}/</span>}
                  {doc.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">{tag}</span>
                  ))}
                  <span className="text-[10px] text-cc-muted ml-auto">{relativeTime(doc.createdAt)}</span>
                </div>
              </div>
              <button type="button" onClick={() => handleDelete(doc.id)}
                className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1 shrink-0" title="Delete">
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Templates Tab ─────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: Array<{ name: string; description?: string; defaultValue?: string; required?: boolean }>;
  tags: string[];
  usageCount: number;
  createdAt: string;
}

function TemplatesTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [useResult, setUseResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await templatesApi.list(categoryFilter || undefined);
      setTemplates(res.templates);
    } catch { /* ignore */ }
    setLoading(false);
  }, [categoryFilter]);

  const loadCategories = useCallback(async () => {
    try {
      const res = await templatesApi.categories();
      setCategories(res.categories);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { loadCategories(); }, [loadCategories]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newContent.trim() || !newCategory.trim()) return;
    setAdding(true);
    try {
      await templatesApi.create({
        name: newName.trim(),
        content: newContent,
        category: newCategory.trim(),
      });
      setNewName(""); setNewContent(""); setNewCategory("");
      setShowForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function handleDelete(id: string) {
    try {
      await templatesApi.delete(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  function startUse(tmpl: Template) {
    setUsingId(tmpl.id);
    setUseResult(null);
    const defaults: Record<string, string> = {};
    for (const v of tmpl.variables) {
      defaults[v.name] = v.defaultValue || "";
    }
    setVarValues(defaults);
  }

  async function handleUse(id: string) {
    try {
      const res = await templatesApi.use(id, varValues);
      setUseResult(res.result);
    } catch { /* ignore */ }
  }

  const CATEGORY_COLORS: Record<string, string> = {
    email: "text-blue-400 bg-blue-500/10",
    report: "text-purple-400 bg-purple-500/10",
    contract: "text-orange-400 bg-orange-500/10",
    invoice: "text-green-400 bg-green-500/10",
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      <div className="flex gap-2">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-accent cursor-pointer">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" onClick={() => setShowForm(!showForm)}
          className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 transition-colors cursor-pointer shrink-0">
          + New
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-3">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Template name"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)}
            placeholder={"Template content...\nUse {{variable_name}} for variables"}
            rows={6} className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent resize-y" />
          <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category (e.g. email, report, contract)"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-3 py-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={adding || !newName.trim() || !newContent.trim() || !newCategory.trim()}
              className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 disabled:opacity-50 transition-colors cursor-pointer">
              {adding ? "Saving..." : "Save Template"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : templates.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {categoryFilter ? "No templates in this category" : "No templates yet. Click + New to create one."}
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="group rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-cc-fg truncate">{tmpl.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_COLORS[tmpl.category] || "text-cc-muted bg-cc-hover"}`}>
                      {tmpl.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-cc-muted">{tmpl.variables.length} variable{tmpl.variables.length !== 1 ? "s" : ""}</span>
                    <span className="text-[10px] text-cc-muted">Used {tmpl.usageCount}x</span>
                    <span className="text-[10px] text-cc-muted ml-auto">{relativeTime(tmpl.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => startUse(tmpl)}
                    className="text-[11px] px-2 py-1 rounded text-cc-accent hover:bg-cc-accent/10 transition-colors cursor-pointer">
                    Use
                  </button>
                  <button type="button" onClick={() => handleDelete(tmpl.id)}
                    className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1" title="Delete">
                    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                      <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                    </svg>
                  </button>
                </div>
              </div>

              {usingId === tmpl.id && (
                <div className="px-4 pb-3 border-t border-cc-border/50 pt-3 space-y-3">
                  {tmpl.variables.length > 0 ? (
                    <>
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider">Fill Variables</h4>
                      {tmpl.variables.map((v) => (
                        <div key={v.name} className="flex items-center gap-2">
                          <label className="text-xs text-cc-muted w-28 shrink-0">{v.name}</label>
                          <input type="text" value={varValues[v.name] || ""} onChange={(e) => setVarValues({ ...varValues, [v.name]: e.target.value })}
                            placeholder={v.description || v.name}
                            className="flex-1 px-2 py-1 text-xs bg-cc-input border border-cc-border rounded text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className="text-xs text-cc-muted">No variables in this template.</p>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleUse(tmpl.id)}
                      className="px-3 py-1.5 text-xs bg-cc-accent text-white rounded hover:bg-cc-accent/80 transition-colors cursor-pointer">
                      Generate
                    </button>
                    <button type="button" onClick={() => { setUsingId(null); setUseResult(null); }}
                      className="px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">
                      Cancel
                    </button>
                  </div>
                  {useResult && (
                    <div className="mt-2 p-3 rounded bg-cc-hover border border-cc-border">
                      <h4 className="text-[10px] font-medium text-cc-muted uppercase tracking-wider mb-1">Result</h4>
                      <pre className="text-xs text-cc-fg whitespace-pre-wrap break-words">{useResult}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Time Tab ──────────────────────────────────────────────────────────────

interface TimeEntry {
  id: string;
  task: string;
  project?: string;
  category?: string;
  startTime: string;
  duration?: number;
  notes?: string;
  source: string;
}

interface ActiveTimer {
  id: string;
  task: string;
  project?: string;
  category?: string;
  startTime: string;
}

interface TimeReport {
  period: string;
  totalMinutes: number;
  byProject: Record<string, number>;
  byCategory: Record<string, number>;
  byDay: Record<string, number>;
}

function TimeTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [timer, setTimer] = useState<ActiveTimer | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [report, setReport] = useState<TimeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState("");
  const [showTimerForm, setShowTimerForm] = useState(false);
  const [timerTask, setTimerTask] = useState("");
  const [timerProject, setTimerProject] = useState("");
  const [timerCategory, setTimerCategory] = useState("");
  const [showLogForm, setShowLogForm] = useState(false);
  const [logTask, setLogTask] = useState("");
  const [logDuration, setLogDuration] = useState("");
  const [logProject, setLogProject] = useState("");
  const [starting, setStarting] = useState(false);
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [timerRes, entriesRes, reportRes] = await Promise.all([
        timeApi.getTimer(),
        timeApi.listEntries(),
        timeApi.report("week"),
      ]);
      setTimer(timerRes.timer);
      setEntries(entriesRes.entries);
      setReport(reportRes);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Update elapsed time every second when timer is running
  useEffect(() => {
    if (!timer) { setElapsed(""); return; }
    function tick() {
      if (!timer) return;
      const diff = Date.now() - new Date(timer.startTime).getTime();
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setElapsed(`${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [timer]);

  async function handleStartTimer(e: React.FormEvent) {
    e.preventDefault();
    if (!timerTask.trim()) return;
    setStarting(true);
    try {
      await timeApi.startTimer(timerTask.trim(), timerProject.trim() || undefined, timerCategory.trim() || undefined);
      setTimerTask(""); setTimerProject(""); setTimerCategory("");
      setShowTimerForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setStarting(false);
  }

  async function handleStopTimer() {
    try {
      await timeApi.stopTimer();
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleLogTime(e: React.FormEvent) {
    e.preventDefault();
    const dur = parseFloat(logDuration);
    if (!logTask.trim() || isNaN(dur) || dur <= 0) return;
    setLogging(true);
    try {
      await timeApi.logTime({
        task: logTask.trim(),
        duration: dur,
        project: logProject.trim() || undefined,
      });
      setLogTask(""); setLogDuration(""); setLogProject("");
      setShowLogForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setLogging(false);
  }

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {/* Active timer */}
      {timer && (
        <div className="rounded-lg border border-cc-accent/50 bg-cc-accent/5 p-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-cc-fg">{timer.task}</h3>
              {timer.project && <span className="text-[10px] text-cc-muted">{timer.project}</span>}
            </div>
            <span className="text-sm font-mono text-cc-accent">{elapsed}</span>
            <button type="button" onClick={handleStopTimer}
              className="px-3 py-1.5 text-xs bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors cursor-pointer">
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!timer && (
          <button type="button" onClick={() => { setShowTimerForm(!showTimerForm); setShowLogForm(false); }}
            className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 transition-colors cursor-pointer">
            Start Timer
          </button>
        )}
        <button type="button" onClick={() => { setShowLogForm(!showLogForm); setShowTimerForm(false); }}
          className="px-3 py-2 text-sm border border-cc-border text-cc-fg rounded-md hover:bg-cc-hover transition-colors cursor-pointer">
          Quick Log
        </button>
      </div>

      {/* Start timer form */}
      {showTimerForm && (
        <form onSubmit={handleStartTimer} className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-3">
          <input type="text" value={timerTask} onChange={(e) => setTimerTask(e.target.value)} placeholder="What are you working on?"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <div className="flex gap-2">
            <input type="text" value={timerProject} onChange={(e) => setTimerProject(e.target.value)} placeholder="Project (optional)"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            <input type="text" value={timerCategory} onChange={(e) => setTimerCategory(e.target.value)} placeholder="Category (optional)"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowTimerForm(false)}
              className="px-3 py-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={starting || !timerTask.trim()}
              className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 disabled:opacity-50 transition-colors cursor-pointer">
              {starting ? "Starting..." : "Start"}
            </button>
          </div>
        </form>
      )}

      {/* Quick log form */}
      {showLogForm && (
        <form onSubmit={handleLogTime} className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-3">
          <div className="flex gap-2">
            <input type="text" value={logTask} onChange={(e) => setLogTask(e.target.value)} placeholder="Task description"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
            <input type="number" value={logDuration} onChange={(e) => setLogDuration(e.target.value)} placeholder="Minutes" min="1" step="1"
              className="w-24 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          <input type="text" value={logProject} onChange={(e) => setLogProject(e.target.value)} placeholder="Project (optional)"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowLogForm(false)}
              className="px-3 py-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={logging || !logTask.trim() || !logDuration}
              className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 disabled:opacity-50 transition-colors cursor-pointer">
              {logging ? "Logging..." : "Log Time"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : (
        <>
          {/* Week report */}
          {report && report.totalMinutes > 0 && (
            <div className="rounded-lg border border-cc-border bg-cc-card p-4">
              <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-3">This Week</h3>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-2xl font-semibold text-cc-fg">{formatDuration(report.totalMinutes)}</span>
                <span className="text-xs text-cc-muted">total</span>
              </div>
              {Object.keys(report.byProject).length > 0 && (
                <div className="space-y-1.5">
                  {Object.entries(report.byProject).sort(([, a], [, b]) => b - a).map(([project, mins]) => (
                    <div key={project} className="flex items-center gap-2">
                      <span className="text-xs text-cc-fg flex-1 truncate">{project || "No project"}</span>
                      <span className="text-xs text-cc-muted">{formatDuration(mins)}</span>
                      <div className="w-20 h-1.5 rounded-full bg-cc-hover overflow-hidden">
                        <div className="h-full rounded-full bg-cc-accent" style={{ width: `${Math.round((mins / report.totalMinutes) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent entries */}
          {entries.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider">Recent Entries</h3>
              {entries.slice(0, 20).map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-cc-border bg-cc-card px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-cc-fg">{entry.task}</span>
                    {entry.project && <span className="text-[10px] text-cc-muted ml-2">{entry.project}</span>}
                  </div>
                  <span className="text-xs text-cc-muted shrink-0">
                    {entry.duration != null ? formatDuration(entry.duration) : "running"}
                  </span>
                  <span className="text-[10px] text-cc-muted shrink-0">{relativeTime(entry.startTime)}</span>
                </div>
              ))}
            </div>
          )}

          {entries.length === 0 && !timer && (
            <div className="text-sm text-cc-muted py-8 text-center">No time entries yet. Start a timer or log time manually.</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── News Tab ──────────────────────────────────────────────────────────────

interface NewsSource {
  id: string;
  name: string;
  type: string;
  url?: string;
  keywords?: string[];
  category: string;
  enabled: boolean;
  lastChecked?: string;
}

interface NewsItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  summary: string;
  url?: string;
  category: string;
  publishedAt: string;
  read: boolean;
  saved: boolean;
  relevance?: number;
}

interface NewsStats {
  total: number;
  unread: number;
  sources: number;
  byCategory: Record<string, number>;
}

function NewsTab({ refreshKey, onRefresh }: { refreshKey: number; onRefresh: () => void }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [stats, setStats] = useState<NewsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [srcName, setSrcName] = useState("");
  const [srcType, setSrcType] = useState("rss");
  const [srcUrl, setSrcUrl] = useState("");
  const [srcKeywords, setSrcKeywords] = useState("");
  const [srcCategory, setSrcCategory] = useState("");
  const [addingSource, setAddingSource] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (search) {
        const res = await newsApi.search(search);
        setItems(res.items as NewsItem[]);
      } else {
        const [itemsRes, statsRes, sourcesRes] = await Promise.all([
          newsApi.list({ limit: 50 }),
          newsApi.stats(),
          newsApi.listSources(),
        ]);
        setItems(itemsRes.items);
        setStats(statsRes);
        setSources(sourcesRes.sources);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleAddSource(e: React.FormEvent) {
    e.preventDefault();
    if (!srcName.trim() || !srcCategory.trim()) return;
    setAddingSource(true);
    try {
      await newsApi.addSource({
        name: srcName.trim(),
        type: srcType,
        category: srcCategory.trim(),
        url: srcUrl.trim() || undefined,
        keywords: srcKeywords ? srcKeywords.split(",").map((k) => k.trim()).filter(Boolean) : undefined,
      });
      setSrcName(""); setSrcType("rss"); setSrcUrl(""); setSrcKeywords(""); setSrcCategory("");
      setShowSourceForm(false);
      onRefresh();
    } catch { /* ignore */ }
    setAddingSource(false);
  }

  async function handleDeleteSource(id: string) {
    try {
      await newsApi.deleteSource(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleMarkRead(id: string) {
    try {
      await newsApi.markRead(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleSave(id: string) {
    try {
      await newsApi.toggleSaved(id);
      onRefresh();
    } catch { /* ignore */ }
  }

  async function handleMarkAllRead() {
    try {
      await newsApi.markAllRead();
      onRefresh();
    } catch { /* ignore */ }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-cc-muted">
          <span>{stats.total} articles</span>
          <span className={stats.unread > 0 ? "text-cc-accent font-medium" : ""}>{stats.unread} unread</span>
          <span>{stats.sources} sources</span>
          {stats.unread > 0 && (
            <button type="button" onClick={handleMarkAllRead}
              className="ml-auto text-xs text-cc-accent hover:text-cc-accent/80 transition-colors cursor-pointer">
              Mark all read
            </button>
          )}
        </div>
      )}

      {/* Search and controls */}
      <div className="flex gap-2">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search news..."
          className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
        <button type="button" onClick={() => { setShowSources(!showSources); setShowSourceForm(false); }}
          className="px-3 py-2 text-sm border border-cc-border text-cc-fg rounded-md hover:bg-cc-hover transition-colors cursor-pointer">
          Sources
        </button>
        <button type="button" onClick={() => { setShowSourceForm(!showSourceForm); setShowSources(false); }}
          className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 transition-colors cursor-pointer shrink-0">
          + Source
        </button>
      </div>

      {/* Source management panel */}
      {showSources && sources.length > 0 && (
        <div className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-2">
          <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-2">Sources</h3>
          {sources.map((src) => (
            <div key={src.id} className="group flex items-center gap-3 py-1.5">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${src.enabled ? "bg-green-400" : "bg-gray-500"}`} />
              <span className="text-sm text-cc-fg flex-1 truncate">{src.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">{src.type}</span>
              <span className="text-[10px] text-cc-muted">{src.category}</span>
              <button type="button" onClick={() => handleDeleteSource(src.id)}
                className="opacity-0 group-hover:opacity-100 text-cc-muted hover:text-red-400 transition-opacity cursor-pointer p-1" title="Delete source">
                <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
                  <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add source form */}
      {showSourceForm && (
        <form onSubmit={handleAddSource} className="rounded-lg border border-cc-border bg-cc-card p-4 space-y-3">
          <input type="text" value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Source name"
            className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          <div className="flex gap-2">
            <select value={srcType} onChange={(e) => setSrcType(e.target.value)}
              className="px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg focus:outline-none focus:border-cc-accent cursor-pointer">
              <option value="rss">RSS Feed</option>
              <option value="website">Website</option>
              <option value="keyword">Keyword Monitor</option>
            </select>
            <input type="text" value={srcCategory} onChange={(e) => setSrcCategory(e.target.value)} placeholder="Category"
              className="flex-1 px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          </div>
          {(srcType === "rss" || srcType === "website") && (
            <input type="text" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="URL"
              className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          )}
          {srcType === "keyword" && (
            <input type="text" value={srcKeywords} onChange={(e) => setSrcKeywords(e.target.value)} placeholder="Keywords (comma-separated)"
              className="w-full px-3 py-2 text-sm bg-cc-input border border-cc-border rounded-md text-cc-fg placeholder-cc-muted focus:outline-none focus:border-cc-accent" />
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSourceForm(false)}
              className="px-3 py-2 text-sm text-cc-muted hover:text-cc-fg transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={addingSource || !srcName.trim() || !srcCategory.trim()}
              className="px-3 py-2 text-sm bg-cc-accent text-white rounded-md hover:bg-cc-accent/80 disabled:opacity-50 transition-colors cursor-pointer">
              {addingSource ? "Adding..." : "Add Source"}
            </button>
          </div>
        </form>
      )}

      {/* News feed */}
      {loading ? (
        <div className="text-sm text-cc-muted py-8 text-center">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-cc-muted py-8 text-center">
          {search ? "No matching articles" : "No news yet. Add sources to start monitoring."}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="group rounded-lg border border-cc-border bg-cc-card hover:border-cc-border-hover transition-colors px-4 py-3">
              <div className="flex items-start gap-3">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.read ? "bg-transparent" : "bg-cc-accent"}`} />
                <div className="flex-1 min-w-0">
                  <h3 className={`text-sm font-medium ${item.read ? "text-cc-muted" : "text-cc-fg"}`}>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{item.title}</a>
                    ) : item.title}
                  </h3>
                  {item.summary && (
                    <p className="text-xs text-cc-muted mt-1 line-clamp-2">{item.summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-cc-muted">{item.sourceName}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cc-hover text-cc-muted">{item.category}</span>
                    <span className="text-[10px] text-cc-muted ml-auto">{relativeTime(item.publishedAt)}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!item.read && (
                    <button type="button" onClick={() => handleMarkRead(item.id)}
                      className="text-[10px] px-1.5 py-0.5 text-cc-muted hover:text-cc-fg transition-colors cursor-pointer" title="Mark read">
                      read
                    </button>
                  )}
                  <button type="button" onClick={() => handleSave(item.id)}
                    className={`text-[10px] px-1.5 py-0.5 transition-colors cursor-pointer ${item.saved ? "text-yellow-400" : "text-cc-muted hover:text-yellow-400"}`} title={item.saved ? "Saved" : "Save"}>
                    {item.saved ? "saved" : "save"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

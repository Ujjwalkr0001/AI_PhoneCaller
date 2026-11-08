import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, ChevronDown, FileUp, Plus, X } from 'lucide-react';
import { outcomeNames } from '../strings.js';

export function Button({
  kind = 'secondary',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <button className={`btn btn-${kind}`} {...props}>
      {children}
    </button>
  );
}
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>((props, ref) => <input className="input" ref={ref} {...props} />);
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input select" {...props} />;
}
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field" data-field-group={label}>
      <label htmlFor={id}>{label}</label>
      {React.isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(
        children,
      )
        ? React.cloneElement(children, {
            id,
            'aria-describedby': hint || error ? `${id}-hint` : undefined,
            'aria-invalid': !!error,
          })
        : children}
      {(error || hint) && (
        <p id={`${id}-hint`} className={error ? 'field-error' : 'helper'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
export function Card({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...props}>
      {children}
    </div>
  );
}
export function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const tone = /^(INTERESTED_HOT|INTERESTED_WARM|CANDIDATE_COMPLETED|running|delivered)$/.test(
    status,
  )
    ? 'positive'
    : /CALLBACK|pending|ringing|scheduled/.test(status)
      ? 'amber'
      : /FAILED|failed|dead_letter/.test(status)
        ? 'negative'
        : 'neutral';
  return (
    <Chip tone={tone}>
      {outcomeNames[status] ?? status.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())}
    </Chip>
  );
}
export function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="segment" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={value === o.value}
          className={value === o.value ? 'selected' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function TagInput({
  value,
  onChange,
  id,
  placeholder = 'Add a requirement',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  id?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const next = text.trim().replace(/,$/, '');
    if (next && !value.includes(next) && value.length < 12) {
      onChange([...value, next]);
      setText('');
    }
  };
  return (
    <div className="tag-input">
      <div className="chips">
        {value.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-entry">
        <input
          id={id}
          aria-label={id ? undefined : 'Add a requirement'}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" aria-label="Add requirement" onClick={add}>
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
export function Disclosure({
  title = 'Details',
  children,
  open,
  onToggle,
  id,
}: {
  title?: string;
  children: React.ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  id?: string;
}) {
  return (
    <details
      className="disclosure"
      id={id}
      open={open}
      onToggle={(e) => onToggle?.(e.currentTarget.open)}
    >
      <summary>
        {title}
        <ChevronDown size={16} />
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}
export function Stepper({ step }: { step: number }) {
  return (
    <ol className="stepper" aria-label="Campaign setup">
      {['Details', 'Contacts', 'Review'].map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? 'step' : undefined}
          className={i === step ? 'current' : i < step ? 'done' : ''}
        >
          <span>{i < step ? <Check size={13} /> : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <ArrowRight size={22} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-group" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <Button onClick={retry}>Try again</Button>
    </div>
  );
}
export function Drawer({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    const handler = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    el?.addEventListener('cancel', handler);
    return () => {
      el?.removeEventListener('cancel', handler);
      el?.close();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      className={`drawer ${wide ? 'drawer-wide' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-top">
        <h2>{title}</h2>
        <Button kind="ghost" aria-label={`Close ${title}`} onClick={onClose}>
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
export function FileDrop({
  onFile,
  label = 'Upload a CSV',
}: {
  onFile: (file: File) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className="file-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <FileUp size={21} />
      <div>
        <strong>{label}</strong>
        <p>Drop a file here, or choose one.</p>
      </div>
      <Button onClick={() => ref.current?.click()} type="button">
        Choose file
      </Button>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        hidden
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
export function OutcomeBar({
  values,
}: {
  values: { label: string; count: number; tone: string }[];
}) {
  const total = values.reduce((sum, v) => sum + v.count, 0);
  return (
    <div className="outcome-block">
      <div className="outcome-bar" aria-hidden="true">
        {values
          .filter((v) => v.count)
          .map((v) => (
            <span
              key={v.label}
              className={`fill-${v.tone}`}
              style={{ width: `${(v.count / total) * 100}%` }}
            />
          ))}
      </div>
      <div className="outcome-legend">
        {values.map((v) => (
          <div key={v.label}>
            <span className={`dot dot-${v.tone}`} />
            <span>{v.label}</span>
            <strong>{v.count}</strong>
            <small>{total ? Math.round((v.count / total) * 100) : 0}%</small>
          </div>
        ))}
      </div>
    </div>
  );
}
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [message, onClose]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <Button kind="ghost" aria-label="Dismiss notification" onClick={onClose}>
        <X size={16} />
      </Button>
    </div>
  );
}

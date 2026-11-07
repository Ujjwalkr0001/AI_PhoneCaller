import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { Trash2 } from 'lucide-react';
import type { Contact } from '../../../../packages/shared/src/index.js';
import { api } from '../api.js';
import { Button, Disclosure, Field, FileDrop, Input, Select, Textarea } from '../ui/index.js';
export interface Validation {
  index: number;
  status: 'valid' | 'invalid' | 'duplicate' | 'suppressed';
}
export function parseContacts(text: string): Contact[] {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  const first = result[0]?.map((s) => s.trim().toLowerCase()) ?? [];
  const hasHeader = first.some((s) =>
    ['phone', 'mobile', 'phone_number', 'number', 'name', 'first_name', 'candidate_name'].includes(
      s,
    ),
  );
  const phoneIndex = first.findIndex((s) =>
    ['phone', 'mobile', 'phone_number', 'number'].includes(s),
  );
  const nameIndex = first.findIndex((s) => ['name', 'first_name', 'candidate_name'].includes(s));
  return result
    .slice(hasHeader ? 1 : 0)
    .slice(0, 200)
    .map((row) => {
      const index = hasHeader
        ? phoneIndex >= 0
          ? phoneIndex
          : 0
        : row.findIndex((v) => v.trim().startsWith('+'));
      const actual = index < 0 ? 0 : index;
      const raw = (row[actual] ?? '').trim();
      const parsed = parsePhoneNumberFromString(raw);
      const name = (
        row[
          hasHeader ? (nameIndex >= 0 ? nameIndex : actual === 0 ? 1 : 0) : actual === 0 ? 1 : 0
        ] ?? ''
      ).trim();
      return {
        phone: raw.startsWith('+') && parsed?.isValid() ? parsed.number : raw,
        first_name: name,
        candidate_name: name,
        current_role: hasHeader ? (row[first.indexOf('current_role')] ?? '') : '',
        source: '',
        sample: false,
      };
    });
}
export default function ContactInput({
  raw,
  onRaw,
  contacts,
  onContacts,
  validation,
  onValidation,
  label = 'Who should we call?',
}: {
  raw: string;
  onRaw: (s: string) => void;
  contacts: Contact[];
  onContacts: (rows: Contact[]) => void;
  validation: Validation[];
  onValidation: (rows: Validation[]) => void;
  label?: string;
}) {
  const [error, setError] = useState(''),
    [removed, setRemoved] = useState<{ row: Contact; index: number }>(),
    [mapping, setMapping] = useState<string[][]>(),
    [phoneColumn, setPhoneColumn] = useState('0'),
    [nameColumn, setNameColumn] = useState('1');
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!contacts.length) {
        onValidation([]);
        return;
      }
      void api<Validation[]>('/contacts/validate', 'POST', contacts)
        .then((rows) => {
          if (!cancelled) {
            onValidation(rows);
            setError('');
          }
        })
        .catch(() => {
          if (!cancelled)
            setError(
              'We couldn’t validate the list. Your draft is saved. Try again before launching.',
            );
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [contacts, onValidation]);
  const update = (text: string) => {
    onRaw(text);
    onContacts(parseContacts(text));
    onValidation([]);
  };
  const counts = (s: string) => validation.filter((r) => r.status === s).length;
  return (
    <div data-field-group="Contacts">
      <FileDrop
        label="Upload contacts CSV"
        onFile={(file) => {
          if (file.size > 1000000) {
            setError('Use a CSV smaller than 1 MB.');
            return;
          }
          void file
            .text()
            .then((text) => {
              const rows = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
              const header = rows[0] ?? [];
              if (
                header.length > 1 &&
                !header.some((v) => /^(phone|mobile|number|phone_number)$/i.test(v.trim())) &&
                !header.some((v) => v.trim().startsWith('+'))
              )
                setMapping(rows);
              else update(text);
            })
            .catch(() => setError('We couldn’t read that file. Paste the list below.'));
        }}
      />
      <div style={{ marginTop: 24 }}>
        <Field
          label={label}
          hint="One number per line, or number,name. Include the country code, for example +91. Up to 200 contacts."
        >
          <Textarea
            value={raw}
            rows={5}
            onChange={(e) => update(e.target.value)}
            placeholder={'+12025550101,Sample contact\n+12025550102,Sample contact'}
          />
        </Field>
      </div>
      {mapping && (
        <Disclosure title="Match your CSV columns" open>
          <div className="inline-grid">
            <Field label="Phone column">
              <Select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)}>
                {mapping[0].map((h, i) => (
                  <option value={i} key={i}>
                    {h}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Name column">
              <Select value={nameColumn} onChange={(e) => setNameColumn(e.target.value)}>
                {mapping[0].map((h, i) => (
                  <option value={i} key={i}>
                    {h}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button
            onClick={() => {
              update(
                Papa.unparse([
                  ['phone', 'first_name'],
                  ...mapping.slice(1).map((r) => [r[Number(phoneColumn)], r[Number(nameColumn)]]),
                ]),
              );
              setMapping(undefined);
            }}
          >
            Use these columns
          </Button>
        </Disclosure>
      )}
      {contacts.length > 0 && (
        <div className="validation" role="status">
          <strong>{counts('valid')} valid</strong>
          <span>{counts('invalid')} invalid</span>
          <span>{counts('suppressed')} do-not-call</span>
          {counts('duplicate') > 0 && <span>{counts('duplicate')} duplicate</span>}
          {!validation.length && <span>Checking numbers…</span>}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {removed && (
        <div className="row helper">
          Contact removed from this draft.
          <Button
            kind="ghost"
            onClick={() => {
              const next = [...contacts];
              next.splice(removed.index, 0, removed.row);
              onContacts(next);
              onRaw(Papa.unparse(next.map((c) => [c.phone, c.first_name])));
              setRemoved(undefined);
            }}
          >
            Undo
          </Button>
        </div>
      )}
      {contacts.length > 0 && (
        <Disclosure title={`Review or fix ${contacts.length} contacts`}>
          <div>
            {contacts.map((contact, index) => (
              <div key={index} className="contact-correction">
                <div>
                  <Input
                    aria-label={`Phone row ${index + 1}`}
                    value={contact.phone}
                    onChange={(e) => {
                      const rows = contacts.map((r, i) =>
                        i === index ? { ...r, phone: e.target.value } : r,
                      );
                      onContacts(rows);
                      onRaw(Papa.unparse(rows.map((c) => [c.phone, c.first_name])));
                    }}
                  />
                  <small>{validation[index]?.status ?? 'Checking'}</small>
                </div>
                <Input
                  className="input name-correction"
                  aria-label={`Name row ${index + 1}`}
                  value={contact.first_name}
                  onChange={(e) => {
                    const rows = contacts.map((r, i) =>
                      i === index
                        ? { ...r, first_name: e.target.value, candidate_name: e.target.value }
                        : r,
                    );
                    onContacts(rows);
                    onRaw(Papa.unparse(rows.map((c) => [c.phone, c.first_name])));
                  }}
                />
                <Button
                  kind="ghost"
                  aria-label={`Remove contact ${index + 1}`}
                  onClick={() => {
                    setRemoved({ row: contact, index });
                    const rows = contacts.filter((_, i) => i !== index);
                    onContacts(rows);
                    onRaw(Papa.unparse(rows.map((c) => [c.phone, c.first_name])));
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Autocomplete,
  Button,
  NumberInput,
  Select,
  TagsInput,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import { authFetchJson } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { buildAuthorityTree } from '../utils/validity';
import { daysUntil, formatDate, percent } from '../utils/timeline';
import { previewFor, splitAltNames } from '../utils/newCertificate';
import type { AuthorityListItem, CertificateListItem } from '../types/pki';
import classes from './CreateCertificate.module.css';

interface Settings {
  organization: string;
  country: string;
  state: string;
  city: string;
  defaultKeyAlgorithm: string;
  defaultRSAKeySize: number;
  defaultECDSACurve: string;
  defaultValidityDays: number;
}

const TYPES = [
  { value: 'server', label: 'Server', hint: 'For a service that clients connect to over TLS.' },
  {
    value: 'client',
    label: 'Client',
    hint: 'For a device or person that proves who it is to a server.',
  },
  {
    value: 'serverclient',
    label: 'Server and client',
    hint: 'One certificate a host uses both ways, as a server and as a client.',
  },
  {
    value: 'selfsigned',
    label: 'Self-signed',
    hint: 'Signed by its own key. Clients will not trust it unless you add it by hand.',
  },
];

const PRESETS = [
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
];

const KEY_OPTIONS = [
  { value: 'rsa:2048', label: 'RSA 2048' },
  { value: 'rsa:3072', label: 'RSA 3072' },
  { value: 'rsa:4096', label: 'RSA 4096' },
  { value: 'ecdsa:P-256', label: 'ECDSA P-256' },
  { value: 'ecdsa:P-384', label: 'ECDSA P-384' },
  { value: 'ecdsa:P-521', label: 'ECDSA P-521' },
  { value: 'ed25519', label: 'Ed25519' },
];

/** "rsa:2048" style key choice from the admin's defaults or a template link. */
function keyChoice(
  algorithm: string | null | undefined,
  rsaKeySize?: number,
  ecdsaCurve?: string,
): string {
  const value =
    algorithm === 'ecdsa'
      ? `ecdsa:${ecdsaCurve || 'P-256'}`
      : algorithm === 'ed25519'
        ? 'ed25519'
        : `rsa:${rsaKeySize || 2048}`;
  return KEY_OPTIONS.some((o) => o.value === value) ? value : 'rsa:2048';
}

function keyPayload(choice: string) {
  const [algorithm, param] = choice.split(':');
  return {
    keyAlgorithm: algorithm,
    rsaKeySize: algorithm === 'rsa' ? Number(param) : 0,
    ecdsaCurve: algorithm === 'ecdsa' ? param : '',
  };
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function SectionHeader({ id, title }: { id: string; title: string }) {
  return (
    <div className={classes.sectionHeader}>
      <h2 id={id} className="gl-section-label">
        {title}
      </h2>
      <span className={classes.rule} />
    </div>
  );
}

/** Issue a certificate, with a live preview of its validity against its authority's. */
function CreateCertificate() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [params] = useSearchParams();
  const today = useMemo(() => new Date(), []);

  const { data: authorities = [] } = useQuery<AuthorityListItem[]>({
    queryKey: ['cas'],
    queryFn: () => authFetchJson('/api/ca'),
  });
  const { data: certificates = [] } = useQuery<CertificateListItem[]>({
    queryKey: ['certificates'],
    queryFn: () => authFetchJson('/api/certificates'),
  });
  // Only admins can read system settings; operators fill the subject in themselves.
  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => authFetchJson('/api/settings'),
    enabled: hasRole('admin'),
    retry: false,
  });

  // Template values from links such as "Issue from here" or "Issue a replacement".
  const [type, setType] = useState(() =>
    TYPES.some((t) => t.value === params.get('type')) ? params.get('type')! : 'server',
  );
  const [caId, setCaId] = useState<string | null>(params.get('caId'));
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState(params.get('groupName') ?? '');
  const [commonName, setCommonName] = useState(params.get('commonName') ?? '');
  const [altNames, setAltNames] = useState<string[]>(() => [
    ...parseList(params.get('dnsNames')),
    ...parseList(params.get('ipAddresses')),
  ]);
  const [description, setDescription] = useState('');
  const [subject, setSubject] = useState({ organization: '', city: '', state: '', country: '' });
  const [editSubject, setEditSubject] = useState(false);
  const [key, setKey] = useState(() => keyChoice(params.get('keyAlgorithm')));
  const [touchedKey, setTouchedKey] = useState(!!params.get('keyAlgorithm'));
  const [editKey, setEditKey] = useState(false);
  const [days, setDays] = useState(() => {
    const n = Number(params.get('validityDays'));
    return n > 0 ? n : 365;
  });
  const [touchedDays, setTouchedDays] = useState(!!params.get('validityDays'));

  // Apply the admin's defaults once they load, without overriding anything already typed.
  useEffect(() => {
    if (!settings) return;
    setSubject((s) =>
      s.organization || s.city || s.state || s.country
        ? s
        : {
            organization: settings.organization,
            city: settings.city,
            state: settings.state,
            country: settings.country,
          },
    );
    if (!touchedKey)
      setKey(
        keyChoice(
          settings.defaultKeyAlgorithm,
          settings.defaultRSAKeySize,
          settings.defaultECDSACurve,
        ),
      );
    if (!touchedDays && settings.defaultValidityDays) setDays(settings.defaultValidityDays);
  }, [settings, touchedDays, touchedKey]);

  // Default to the authority that lasts longest, so a new certificate fits inside it.
  const usable = useMemo(
    () =>
      buildAuthorityTree(authorities, certificates).map((n) =>
        authorities.find((a) => a.id === n.authority.id)!,
      ),
    [authorities, certificates],
  );
  useEffect(() => {
    if (caId || usable.length === 0) return;
    const longest = [...usable].sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0];
    if (longest && daysUntil(longest.expiresAt, today) > 0) setCaId(longest.id);
  }, [caId, usable, today]);

  const noAuthorities = authorities.length === 0;
  const selfSigned = type === 'selfsigned' || noAuthorities;
  const authority = selfSigned ? null : (authorities.find((a) => a.id === caId) ?? null);
  const preview = previewFor(today, days, authority, authorities);
  const groupNames = [...new Set(certificates.map((c) => c.groupName).filter(Boolean))].sort();
  const subjectLine = [subject.organization, subject.city, subject.state, subject.country]
    .filter(Boolean)
    .join(' · ');
  // Summarise the subject only when the admin's defaults supplied one; otherwise keep the fields
  // open, so typing into an empty form never collapses them.
  const hasDefaultSubject =
    !!settings &&
    [settings.organization, settings.city, settings.state, settings.country].some(Boolean);

  const create = useMutation({
    mutationFn: () => {
      const { dnsNames, ipAddresses } = splitAltNames(altNames);
      return authFetchJson('/api/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          commonName: commonName.trim(),
          type: selfSigned ? 'selfsigned' : type,
          certificateAuthorityId: selfSigned ? null : caId,
          dnsNames,
          ipAddresses,
          ...subject,
          ...keyPayload(key),
          validityDays: days,
          groupName: groupName.trim(),
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certGroups'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      notifications.show({ message: `${name.trim()} created.` });
      navigate('/certificates');
    },
  });

  const missing = !name.trim() || !commonName.trim() || (!selfSigned && !authority) || days < 1;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!missing) create.mutate();
  };

  // Preview scale: the longer of the certificate and its authority, from today.
  const scale = Math.max(days, preview.authorityDays ?? 0, 1);
  const certWidth = days / scale;
  const caWidth =
    preview.authorityDays !== null ? Math.max(0, preview.authorityDays) / scale : null;

  return (
    <div className={classes.page}>
      <div>
        <nav aria-label="Breadcrumb" className={classes.breadcrumb}>
          <Link to="/certificates">Certificates</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">New</span>
        </nav>
        <h1 className={classes.title}>New certificate</h1>
      </div>

      <div className={classes.layout}>
        <form id="new-certificate" className={classes.form} onSubmit={submit} noValidate>
          <section className={classes.section} aria-labelledby="ty-h">
            <SectionHeader id="ty-h" title="Type" />
            <div role="radiogroup" aria-labelledby="ty-h" className={classes.segments}>
              {TYPES.filter((t) => !noAuthorities || t.value === 'selfsigned').map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={(selfSigned ? 'selfsigned' : type) === t.value}
                  className={classes.segment}
                  onClick={() => setType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className={classes.hint}>
              {TYPES.find((t) => t.value === (selfSigned ? 'selfsigned' : type))!.hint}
            </p>
          </section>

          <section className={classes.section} aria-labelledby="ca-h">
            <SectionHeader id="ca-h" title="Issued by" />
            {selfSigned ? (
              <p className={classes.body}>
                {noAuthorities
                  ? 'There is no authority you can issue from yet, so this certificate signs itself.'
                  : 'A self-signed certificate signs itself, so no authority is used.'}
              </p>
            ) : (
              <div role="radiogroup" aria-labelledby="ca-h" className={classes.options}>
                {usable.map((a) => {
                  const left = daysUntil(a.expiresAt, today);
                  const count = certificates.filter(
                    (c) => c.certificateAuthorityId === a.id,
                  ).length;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === caId}
                      className={classes.option}
                      onClick={() => setCaId(a.id)}
                    >
                      <span className={classes.radio} aria-hidden="true" />
                      <span className={classes.optionText}>
                        <span className={classes.optionName}>{a.name}</span>
                        <span className="gl-second-line gl-tnum">
                          {count} {count === 1 ? 'certificate' : 'certificates'} ·{' '}
                          {left < 0 ? 'ended' : 'ends'} {formatDate(a.expiresAt)}
                          {left >= 0 && left < 400 ? `, in ${left} days` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className={classes.section} aria-labelledby="id-h">
            <SectionHeader id="id-h" title="Identity" />
            <div className={classes.pair}>
              <TextInput
                label="Name"
                placeholder="nas-lxc"
                required
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <Autocomplete
                label="Group (optional)"
                placeholder="None"
                data={groupNames}
                value={groupName}
                onChange={setGroupName}
              />
            </div>
            <TextInput
              label="Common name"
              placeholder="nas.home.arpa"
              required
              value={commonName}
              onChange={(e) => setCommonName(e.currentTarget.value)}
            />
            <TagsInput
              label="Alternative names"
              description="Browsers check these, not the common name. Add every name clients use."
              placeholder="Type a DNS name or IP address, then press Enter"
              value={altNames}
              onChange={setAltNames}
              splitChars={[',', ' ']}
              clearable
            />
            <Textarea
              label="Description (optional)"
              autosize
              minRows={2}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
          </section>

          <section className={classes.section} aria-labelledby="df-h">
            <SectionHeader id="df-h" title={settings ? 'From your defaults' : 'Subject and key'} />
            {editSubject || !hasDefaultSubject ? (
              <div className={classes.pair}>
                <TextInput
                  label="Organization"
                  value={subject.organization}
                  onChange={(e) => setSubject({ ...subject, organization: e.currentTarget.value })}
                />
                <TextInput
                  label="City"
                  value={subject.city}
                  onChange={(e) => setSubject({ ...subject, city: e.currentTarget.value })}
                />
                <TextInput
                  label="State"
                  value={subject.state}
                  onChange={(e) => setSubject({ ...subject, state: e.currentTarget.value })}
                />
                <TextInput
                  label="Country"
                  placeholder="PT"
                  maxLength={2}
                  value={subject.country}
                  onChange={(e) =>
                    setSubject({ ...subject, country: e.currentTarget.value.toUpperCase() })
                  }
                />
              </div>
            ) : (
              <div className={classes.default}>
                <span className={classes.defaultLabel}>Subject</span>
                <span>{subjectLine}</span>
                <button
                  type="button"
                  className={classes.linkButton}
                  onClick={() => setEditSubject(true)}
                >
                  Change
                </button>
              </div>
            )}
            {editKey ? (
              <Select
                label="Key"
                data={KEY_OPTIONS}
                value={key}
                onChange={(v) => {
                  if (!v) return;
                  setKey(v);
                  setTouchedKey(true);
                }}
                allowDeselect={false}
                w={200}
              />
            ) : (
              <div className={classes.default}>
                <span className={classes.defaultLabel}>Key</span>
                <span>{KEY_OPTIONS.find((o) => o.value === key)?.label}</span>
                <button
                  type="button"
                  className={classes.linkButton}
                  onClick={() => setEditKey(true)}
                >
                  Change
                </button>
              </div>
            )}
          </section>

          <section className={classes.section} aria-labelledby="vd-h">
            <SectionHeader id="vd-h" title="Validity" />
            <div className={classes.validityRow}>
              <div role="radiogroup" aria-labelledby="vd-h" className={classes.segments}>
                {PRESETS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    role="radio"
                    aria-checked={days === p.days}
                    className={classes.segment}
                    onClick={() => {
                      setDays(p.days);
                      setTouchedDays(true);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <NumberInput
                aria-label="Days"
                min={1}
                max={3650}
                value={days}
                onChange={(v) => {
                  setDays(Math.max(1, Number(v) || 1));
                  setTouchedDays(true);
                }}
                rightSection={<span className="gl-second-line">days</span>}
                rightSectionWidth={44}
                w={140}
              />
            </div>
          </section>
        </form>

        <aside className={classes.preview} aria-label="Preview">
          <SectionHeader id="pv-h" title="Preview" />
          <div className={classes.bars} aria-hidden="true">
            <div className={classes.track}>
              {caWidth !== null && (
                <span
                  className={classes.caBar}
                  style={{ width: percent(caWidth) }}
                  title={authority?.name}
                />
              )}
            </div>
            <div className={classes.track}>
              <span
                className={classes.certBar}
                style={{
                  width: percent(preview.outlives && caWidth !== null ? caWidth : certWidth),
                }}
              />
              {preview.outlives && caWidth !== null && (
                <span
                  className={`${classes.over} gl-hatch`}
                  style={{ left: percent(caWidth), width: percent(certWidth - caWidth) }}
                />
              )}
            </div>
            <div
              className={`${classes.scale} gl-literal gl-tnum`}
              style={{ color: 'var(--gl-text-muted)' }}
            >
              <span>Today</span>
              {preview.outlives && authority && (
                <span style={{ color: 'var(--gl-warning)' }}>
                  {formatDate(authority.expiresAt)}
                </span>
              )}
              <span>{formatDate(preview.end.toISOString())}</span>
            </div>
            <div className={classes.legend}>
              <span>
                <span className={classes.swatch} style={{ background: 'var(--gl-text-soft)' }} />
                This certificate
              </span>
              {authority && (
                <span>
                  <span
                    className={classes.swatch}
                    style={{ border: '2px solid var(--gl-text-muted)' }}
                  />
                  {authority.name}
                </span>
              )}
            </div>
          </div>

          {preview.outlives && authority && (
            <div role="alert" className={classes.alert}>
              <span className={classes.alertIcon}>
                <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
              </span>
              <div>
                <p className={classes.body}>
                  {preview.authorityDays !== null && preview.authorityDays <= 0
                    ? `${authority.name} has ended. Clients will not trust anything it signs.`
                    : `This would outlive ${authority.name} by ${preview.outlivesBy} days. Clients stop trusting it on ${formatDate(authority.expiresAt)}.`}
                </p>
                <div className={classes.fixes}>
                  {preview.fitDays !== null && (
                    <button
                      type="button"
                      className={classes.linkButton}
                      onClick={() => {
                        setDays(preview.fitDays!);
                        setTouchedDays(true);
                      }}
                    >
                      Shorten to {preview.fitDays} days
                    </button>
                  )}
                  {preview.alternative && (
                    <button
                      type="button"
                      className={classes.linkButton}
                      onClick={() => setCaId(preview.alternative!.id)}
                    >
                      Use {preview.alternative.name}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <dl className={classes.facts}>
            <dt>Subject</dt>
            <dd className="gl-literal">
              CN={commonName.trim() || '…'}
              {subject.organization && `, O=${subject.organization}`}
              {subject.city && `, L=${subject.city}`}
              {subject.state && `, ST=${subject.state}`}
              {subject.country && `, C=${subject.country}`}
            </dd>
            <dt>Issued by</dt>
            <dd>{selfSigned ? 'Itself' : (authority?.name ?? 'Choose an authority')}</dd>
            <dt>Valid</dt>
            <dd className="gl-tnum">
              {formatDate(today.toISOString())} to {formatDate(preview.end.toISOString())}
            </dd>
            <dt>First alert</dt>
            <dd className="gl-tnum">{formatDate(preview.firstAlert.toISOString())}</dd>
            <dt>Key</dt>
            <dd>{KEY_OPTIONS.find((o) => o.value === key)?.label}</dd>
          </dl>

          {create.isError && <p className={classes.error}>{(create.error as Error).message}</p>}

          <div className={classes.submit}>
            <Button
              type="submit"
              form="new-certificate"
              loading={create.isPending}
              disabled={missing}
            >
              Create certificate
            </Button>
            <Link to="/certificates">Cancel</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default CreateCertificate;

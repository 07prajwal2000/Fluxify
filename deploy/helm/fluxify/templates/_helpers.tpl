{{- define "fluxify.labels" -}}
app.kubernetes.io/part-of: fluxify
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "fluxify.image" -}}
{{ .root.Values.image.registry }}/{{ .name }}:{{ .root.Values.image.tag | default .root.Chart.AppVersion }}
{{- end }}

{{/*
Settings admin and the orchestrator both need but that are not secret. The
workers get theirs from the orchestrator, never from here.
*/}}
{{- define "fluxify.config" -}}
{{- $ns := .Release.Namespace -}}
DB_VARIANT: postgres
{{- if .Values.nats.enabled }}
NATS_URL: nats://fluxify-nats.{{ $ns }}.svc:4222
{{- else }}
NATS_URL: {{ required "nats.enabled is false: set external.natsUrl" .Values.external.natsUrl | quote }}
{{- end }}
{{- if .Values.valkey.enabled }}
REDIS_HOST: fluxify-valkey.{{ $ns }}.svc
REDIS_PORT: "6379"
REDIS_USER: default
{{- else }}
REDIS_HOST: {{ required "valkey.enabled is false: set external.redisHost" .Values.external.redisHost | quote }}
REDIS_PORT: {{ .Values.external.redisPort | quote }}
REDIS_USER: {{ .Values.external.redisUser | quote }}
{{- end }}
SERVER_URL: {{ .Values.url | quote }}
BETTER_AUTH_URL: {{ .Values.url | quote }}
TRUSTED_ORIGINS: {{ .Values.url | quote }}
{{- range $key, $value := .Values.env }}
{{ $key }}: {{ $value | quote }}
{{- end }}
{{- end }}

{{/*
The database URL, for the demo Postgres. Kubernetes fills $(PG_PASSWORD) in
from the Secret, so the password is never written into a manifest.
*/}}
{{- define "fluxify.pgEnv" -}}
{{- if .Values.postgres.bundled }}
- name: PG_URL
  value: postgres://fluxify:$(PG_PASSWORD)@fluxify-postgres:5432/fluxify
{{- else if .Values.postgres.urlFrom.secret }}
- name: PG_URL
  valueFrom:
    secretKeyRef: { name: {{ .Values.postgres.urlFrom.secret }}, key: {{ .Values.postgres.urlFrom.key }} }
{{- end }}
{{- end }}

{{- define "fluxify.envFrom" -}}
- configMapRef: { name: fluxify-config }
- secretRef: { name: fluxify-env }
{{- end }}

{{/* Restarts the pods when the settings change; a Secret you manage yourself is not seen. */}}
{{- define "fluxify.checksum" -}}
checksum/config: {{ include "fluxify.config" . | sha256sum }}
checksum/secret: {{ toJson .Values.secret | sha256sum }}
{{- end }}

{{- define "fluxify.license" -}}
{{- if .Values.license.issuerKeySecret }}
volumeMounts:
  - { name: license, mountPath: /etc/fluxify/license, readOnly: true }
{{- end }}
{{- end }}

{{- define "fluxify.licenseVolume" -}}
{{- if .Values.license.issuerKeySecret }}
volumes:
  - name: license
    secret: { secretName: {{ .Values.license.issuerKeySecret }} }
{{- end }}
{{- end }}

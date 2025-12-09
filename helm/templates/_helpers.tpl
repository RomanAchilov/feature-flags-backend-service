{{/*
═══════════════════════════════════════════════════════════════════════════════
Feature Flags Backend — Helm Template Helpers
═══════════════════════════════════════════════════════════════════════════════
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "feature-flags-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "feature-flags-backend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "feature-flags-backend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "feature-flags-backend.labels" -}}
helm.sh/chart: {{ include "feature-flags-backend.chart" . }}
{{ include "feature-flags-backend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "feature-flags-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "feature-flags-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "feature-flags-backend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "feature-flags-backend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Get the secret name to use
*/}}
{{- define "feature-flags-backend.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "feature-flags-backend.fullname" . }}-secrets
{{- end }}
{{- end }}

{{/*
Get PostgreSQL host
*/}}
{{- define "feature-flags-backend.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" .Release.Name }}
{{- else }}
{{- required "External database host is required when postgresql.enabled=false" .Values.externalDatabase.host }}
{{- end }}
{{- end }}


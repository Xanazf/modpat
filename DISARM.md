# DISARM Framework: Technical Reference & Operational Guide

## 1. Executive Summary & Overview

The **DISARM (Disinformation Analysis and Risk Management)** framework—formerly known as **AMITT (Adversarial Misinformation and Incident Response Tactics and Techniques)**—is an open-source, standardized taxonomy designed to describe, analyze, and counter Foreign Information Manipulation and Interference (FIMI) and influence operations.

Modeled directly after the **MITRE ATT&CK®** cybersecurity framework, DISARM applies threat intelligence principles to cognitive security. It provides a common language and structured data model for security researchers, platforms, defense analysts, and intelligence agencies to track adversary Tactics, Techniques, and Procedures (TTPs).

### Core Objectives
- **Standardization:** Establish a common vocabulary for describing cognitive and behavioral threat patterns across platforms.
- **Interoperability:** Enable seamless threat data sharing using standard threat intelligence schemas (e.g., STIX 2.1 / TAXII).
- **Actionability:** Map adversary techniques (Red Framework) directly to defensive countermeasures and response playbooks (Blue Framework).
- **Attribution & Pattern Recognition:** Identify recurring campaign archetypes, shared infrastructure, and coordinated operational signatures over time.

---

## 2. Operational Dual-Structure: Red vs. Blue Frameworks

DISARM is architected as two interlocking matrix models:

```
+-----------------------------------------------------------------------+
|                         DISARM FRAMEWORK                              |
+-----------------------------------------------------------------------+
|                                                                       |
|   +---------------------------------------------------------------+   |
|   |                       DISARM RED MATRIX                       |   |
|   |         (Adversary Tactics, Techniques & Procedures)          |   |
|   |                                                               |   |
|   |  Plan -> Target -> Asset Dev -> Channel Prep -> Content Gen   |   |
|   |    -> Seed -> Amplify -> Persist -> Realize Impact            |   |
|   +-------------------------------+-------------------------------+   |
|                                   |                                   |
|                                   v                                   |
|   +---------------------------------------------------------------+   |
|   |                      DISARM BLUE MATRIX                       |   |
|   |             (Defender Response & Countermeasures)             |   |
|   |                                                               |   |
|   |  Detect -> Analyze & Attribute -> Neutralize -> Resilience    |   |
|   +---------------------------------------------------------------+   |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 2.1 DISARM Red (Attacker Domain)
DISARM Red codifies the adversary lifecycle across **9 Strategic Tactics** (Phases), containing over 100 granular Techniques and Sub-techniques:

| Tactic Code | Tactic Name | Core Objective |
| :--- | :--- | :--- |
| **TA01** | Plan Strategy | Define high-level operational goals, target selection, and strategic intent. |
| **TA02** | Target Analysis | Vulnerability assessment, demographic research, and audience segmentation. |
| **TA03** | Develop Assets | Build or acquire operational infrastructure, accounts, personas, and front organizations. |
| **TA04** | Establish Channels | Prepare distribution pipelines, domain infrastructure, and cross-platform relays. |
| **TA05** | Create Content | Craft narrative vectors, synthetic media, altered documents, and emotional hooks. |
| **TA06** | Seed Content | Execute initial injection of content into target information ecosystems. |
| **TA07** | Amplify Content | Mass distribution via automation, coordinated inauthentic behavior, or influencer co-optation. |
| **TA08** | Persist & Adapt | Maintain campaign momentum, evade platform moderation, and shift narrative focus. |
| **TA09** | Realize Impact | Convert cognitive/digital manipulation into tangible political, social, or economic offline outcomes. |

### 2.2 DISARM Blue (Defender Domain)
DISARM Blue maps active defenses against specific Red TTPs, categorized into four functional response pillars:
1. **Detect & Monitor:** Telemetry collection, graph anomaly detection, keyword/embedding tracking, network clustering.
2. **Analyze & Attribute:** Origin tracing, behavioral fingerprinting, narrative clustering, STIX mapping.
3. **Neutralize & Disrupt:** Platform moderation, account/domain suspension, shadow-demotion, algorithmic downranking, counter-messaging.
4. **Resilience & Evaluation:** Inoculation/prebunking, media literacy campaigns, post-incident retrospective analysis.

---

## 3. Key DISARM Red Techniques Breakdown

Below is a detailed breakdown of representative adversary techniques across key campaign phases:

### Phase 1: Infrastructure & Asset Development (TA03)

* **T0010 — Synthetic Personas:** Creating fake social identities using AI-generated avatars (e.g., StyleGAN profile pictures), fabricated biographies, and backstories to pass manual inspection.
* **T0012 — Account Compromise:** Hijacking legitimate accounts with existing follower networks through credential stuffing, phishing, or session stealing to bypass new-account trust filters.
* **T0015 — Botnet Construction:** Assembling collections of automated or semi-automated (cyborg) scripts to execute coordinated actions (likes, retweets, comments) on command.
* **T0022 — Proxy Media Creation:** Establishing pseudo-independent news websites, blogs, or local news fronts designed to masquerade as objective journalism while relaying state-backed or partisan narratives.

### Phase 2: Content Generation & Narrative Engineering (TA05)

* **T0035 — Decontextualization / Malinformation:** Taking authentic photographs, video clips, or quotes and embedding them in false contexts to manipulate perception without forging raw assets.
* **T0038 — Synthetic Media Generation:** Producing deepfake audio/video, AI-generated synthetic images, or automated LLM narrative rewrites designed to mimic specific domain styles.
* **T0041 — Affective Priming:** Engineering text and visuals to trigger high-arousal negative emotional states (fear, moral outrage, disgust), optimizing the payload for cognitive bypass and viral re-sharing.
* **T0045 — Conspiracy Vectoring:** Constructing modular narrative structures that attribute complex real-world events to secret, malicious cabals, tapping into pre-existing cognitive biases.

### Phase 3: Seeding & Distribution (TA06 & TA07)

* **T0052 — Microtargeted Injection:** Leveraging granular demographic, psychographic, or regional metadata to deliver specific narrative variants to susceptible target cohorts.
* **T0058 — Multi-Stage Cross-Platform Hopping:** Seeding narrative content in low-moderation fringe environments (e.g., imageboards, uncensored chat apps), pushing it through aggregator networks, and escalating it onto Tier-1 public platforms.
* **T0065 — Coordinated Inauthentic Behavior (CIB):** Orchestrating clusters of accounts to act synchronously—posting identical text, linking same domains, or cross-amplifying each other to fake organic consensus (Astroturfing).
* **T0070 — Algorithmic Exploitation & Hashtag Hijacking:** Gaming recommendation engines via rapid velocity posting, keyword stuffing, and search engine optimization (SEO) manipulation to dominate trending topics.
* **T0074 — Elite / Influencer Co-optation:** Laundering messaging through high-profile figures, political commentators, or mainstream journalists who unknowingly or opportunistically validate and broadcast the asset.

---

## 4. Integration with Cyber Threat Intelligence (CTI) & STIX 2.1

DISARM is structured to integrate into existing Threat Intelligence Platforms (TIPs) and Security Information and Event Management (SIEM) systems.

### STIX 2.1 Object Mapping
Information operations mapped under DISARM can be formatted into standard **STIX 2.1 JSON** objects:

```json
{
  "type": "attack-pattern",
  "spec_version": "2.1",
  "id": "attack-pattern--d8f31b2e-741a-4c22-b94f-56128c948011",
  "created": "2026-03-01T12:00:00.000Z",
  "modified": "2026-03-01T12:00:00.000Z",
  "name": "Coordinated Inauthentic Amplification",
  "description": "Utilizing coordinated bot networks to artificially boost hashtag visibility.",
  "external_references": [
    {
      "source_name": "DISARM",
      "external_id": "T0065"
    }
  ],
  "x_disarm_tactic": ["TA07-Amplify"]
}
```

### Graph Database Representation
Threat intelligence pipelines represent DISARM campaigns as directed, heterogeneous graphs $G = (V, E)$:
- **Nodes ($V$):** `ThreatActor`, `Persona`, `InfrastructureDomain`, `SocialAccount`, `NarrativePayload`, `DISARM_Technique`.
- **Edges ($E$):** `USES_TECHNIQUE`, `OPERATES_ACCOUNT`, `PUBLISHES_TO`, `AMPLIFIES`, `TARGETS_AUDIENCE`.

---

## 5. Comparative Taxonomy Matrix

| Metric / Dimension | MITRE ATT&CK | DISARM (Red) | Cyber Kill Chain |
| :--- | :--- | :--- | :--- |
| **Primary Domain** | Network / Endpoint Cyber Security | Information / Cognitive Security | Military / Enterprise Cyber Defense |
| **Target System** | Operating Systems, Hardware, Networks | Human Perception, Social Trust, Public Opinion | Enterprise Network Perimeter & Internal Systems |
| **Payload Type** | Malware, Shellcode, Exploits | Narratives, Memes, Deepfakes, Decontextualized Media | Executables, Exploits, Command Scripts |
| **Key Metric** | System Compromise / Data Exfiltration | Behavioral Change / Polarization / Disruption | Breach Success / Lateral Movement |
| **Evasion Tactics** | Antivirus / EDR Evasion, Encryption | Moderation Evasion, LLM Rewriting, Laundering | Obfuscation, Anti-Analysis, Protocol Tunneling |

---

## 6. Summary & Application Checklist

When assessing an operational dataset for malicious influence patterns using DISARM:
1. **Identify the Tactic Stage:** Determine if the activity represents Asset Development (TA03), Seeding (TA06), or Mass Amplification (TA07).
2. **Tag Specific Techniques:** Assign DISARM technique IDs (e.g., `T0015` for botnets, `T0065` for CIB, `T0041` for emotional triggers).
3. **Map to Blue Countermeasures:** Query the DISARM Blue Matrix to identify appropriate interventions (e.g., network graph partitioning, C2PA media provenance verification, user prebunking).
4. **Export STIX Telemetry:** Document indicators (shared IP subnets, account creation timestamps, vector embeddings) into STIX format for automated sharing across threat intelligence sharing communities.


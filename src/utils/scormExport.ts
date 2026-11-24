import type { CourseProject } from '../types';

export interface ZipEntryInput {
  name: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pure TypeScript ZIP builder (Store method 0, valid CRC-32 & Central Directory).
 * Works in browser and Node.js without native addons or external ZIP libraries.
 */
export function buildZipArchive(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes =
      typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const checksum = crc32(dataBytes);
    const size = dataBytes.length;

    // Local File Header (30 bytes + name + data)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // Version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method 0 (STORE)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0x5421, true); // Mod date
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central Directory File Header (46 bytes + name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 filename flag
    cv.setUint16(10, 0, true); // Compression method 0 (STORE)
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0x5421, true); // Mod date
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralDirSize + eocd.length;
  const output = new Uint8Array(totalSize);
  let ptr = 0;
  for (const part of localParts) {
    output.set(part, ptr);
    ptr += part.length;
  }
  for (const part of centralParts) {
    output.set(part, ptr);
    ptr += part.length;
  }
  output.set(eocd, ptr);
  return output;
}

function escapeXml(str: string | undefined): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(str: string | undefined): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SCORM_API_JS = `/* Lightweight SCORM 1.2 Runtime Wrapper (eStudy Course Builder V2) */
(function (global) {
  function findApi(win) {
    var attempts = 0;
    while (!win.API && win.parent && win.parent !== win && attempts < 10) {
      attempts++;
      win = win.parent;
    }
    return win.API || (win.opener && win.opener.API) || null;
  }
  var api = findApi(global);
  var initialized = false;
  global.eStudyScorm = {
    init: function () {
      if (api && !initialized) {
        api.LMSInitialize("");
        initialized = true;
      }
    },
    complete: function (scorePercent) {
      if (api) {
        if (!initialized) global.eStudyScorm.init();
        if (typeof scorePercent === "number") {
          api.LMSSetValue("cmi.core.score.raw", String(scorePercent));
        }
        api.LMSSetValue("cmi.core.lesson_status", "completed");
        api.LMSCommit("");
        api.LMSFinish("");
      }
    }
  };
  global.addEventListener("load", function () { global.eStudyScorm.init(); });
})(window);
`;

export function buildScorm12ZipEntries(project: CourseProject): ZipEntryInput[] {
  const safeId = (project.brief.code || project.id || 'ESTUDY-COURSE').replace(/[^A-Za-z0-9_-]/g, '_');
  const title = project.brief.title || 'eStudy Course';
  const modules = project.content.modules || [];

  const orgItems = [
    `      <item identifier="ITEM-OVERVIEW" identifierref="RES-OVERVIEW">
        <title>Course Overview &amp; Learning Outcomes</title>
      </item>`,
    ...modules.map(
      m => `      <item identifier="ITEM-MOD-${m.moduleNumber}" identifierref="RES-MOD-${m.moduleNumber}">
        <title>Module ${m.moduleNumber}: ${escapeXml(m.title)}</title>
      </item>`
    ),
    `      <item identifier="ITEM-ASSESSMENT" identifierref="RES-ASSESSMENT">
        <title>Assessments &amp; Mastery Criteria</title>
      </item>`,
  ].join('\n');

  const resourceItems = [
    `    <resource identifier="RES-OVERVIEW" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="shared/scorm_api.js"/>
    </resource>`,
    ...modules.map(
      m => `    <resource identifier="RES-MOD-${m.moduleNumber}" type="webcontent" adlcp:scormtype="sco" href="module-${m.moduleNumber}.html">
      <file href="module-${m.moduleNumber}.html"/>
      <file href="shared/scorm_api.js"/>
    </resource>`
    ),
    `    <resource identifier="RES-ASSESSMENT" type="webcontent" adlcp:scormtype="sco" href="assessments.html">
      <file href="assessments.html"/>
      <file href="shared/scorm_api.js"/>
    </resource>`,
  ].join('\n');

  const imsManifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-${escapeXml(safeId)}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-${escapeXml(safeId)}">
    <organization identifier="ORG-${escapeXml(safeId)}">
      <title>${escapeXml(title)}</title>
${orgItems}
    </organization>
  </organizations>
  <resources>
${resourceItems}
  </resources>
</manifest>
`;

  const wrapHtml = (pageTitle: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pageTitle)} — ${escapeHtml(title)}</title>
  <script src="shared/scorm_api.js"></script>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; max-width: 900px; margin: 32px auto; padding: 0 20px; line-height: 1.6; }
    header { border-bottom: 3px solid #052B66; padding-bottom: 12px; margin-bottom: 24px; }
    .brand { color: #052B66; font-weight: 700; font-size: 12px; letter-spacing: 0.06em; }
    h1, h2, h3 { color: #052B66; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0; background: #f8fafc; }
    .btn { background: #052B66; color: #fff; border: 0; border-radius: 6px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <header>
    <div class="brand">eSTUDY SOUTH AFRICA · ${escapeHtml(project.brief.code || 'COURSE')}</div>
    <h1>${escapeHtml(pageTitle)}</h1>
  </header>
  ${body}
  <div style="margin-top:28px;padding-top:16px;border-top:1px solid #cbd5e1;">
    <button class="btn" onclick="window.eStudyScorm && window.eStudyScorm.complete(100); alert('Module marked completed in LMS.');">Mark SCO Completed</button>
  </div>
</body>
</html>`;

  const overviewBody = `
    <p><strong>Course:</strong> ${escapeHtml(title)} (${escapeHtml(project.brief.code)})</p>
    <p><strong>Industry / Domain:</strong> ${escapeHtml(project.brief.industryDomain)}</p>
    <p><strong>Target Audience:</strong> ${escapeHtml(project.brief.targetAudience)}</p>
    <p><strong>Estimated Duration:</strong> ${escapeHtml(project.brief.estimatedDuration)}</p>
    <div class="card"><h3>Purpose</h3><p>${escapeHtml(project.brief.purpose)}</p></div>
    <h2>Course Learning Outcomes</h2>
    <ul>
      ${project.outcomes.courseOutcomes
        .map(o => `<li><strong>${escapeHtml(o.code)} [${escapeHtml(o.bloomLevel)}]:</strong> ${escapeHtml(o.statement)}</li>`)
        .join('\n')}
    </ul>
    <h2>Modules</h2>
    <ul>
      ${modules
        .map(m => `<li><a href="module-${m.moduleNumber}.html">Module ${m.moduleNumber}: ${escapeHtml(m.title)}</a></li>`)
        .join('\n')}
      <li><a href="assessments.html">Assessments &amp; Mastery Criteria</a></li>
    </ul>`;

  const moduleEntries: ZipEntryInput[] = modules.map(m => {
    const modBody = `
      <p>${escapeHtml(m.introduction)}</p>
      <h2>Lessons</h2>
      ${m.lessons
        .map(
          l => `<div class="card">
            <h3>${escapeHtml(l.title)} (${l.durationMinutes} min)</h3>
            <p>${escapeHtml(l.explanation).replace(/\n/g, '<br/>')}</p>
            ${l.workedExamples.length ? `<p><strong>Worked Examples:</strong><br/>${l.workedExamples.map(e => escapeHtml(e)).join('<br/><br/>')}</p>` : ''}
            <p><strong>Practical Application:</strong> ${escapeHtml(l.practicalApplication)}</p>
            <p><strong>Guided Activity:</strong> ${escapeHtml(l.guidedActivity)}</p>
          </div>`
        )
        .join('\n')}
      ${
        m.scenarios.length
          ? `<h2>Workplace Scenarios</h2>${m.scenarios
              .map(
                s => `<div class="card"><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.situation)}</p><p><strong>Challenge:</strong> ${escapeHtml(s.challenge)}</p><p><strong>Decision Prompt:</strong> ${escapeHtml(s.decisionPrompt)}</p></div>`
              )
              .join('\n')}`
          : ''
      }
      <div class="card"><h3>Module Summary</h3><p>${escapeHtml(m.summary)}</p></div>
    `;
    return {
      name: `module-${m.moduleNumber}.html`,
      content: wrapHtml(`Module ${m.moduleNumber}: ${m.title}`, modBody),
    };
  });

  const assessmentBody = `
    <p><strong>Pass Threshold:</strong> ${project.assessments.passRequirementPercent}% (Knowledge ${project.assessments.knowledgeWeightPercent}% / Practical ${project.assessments.practicalWeightPercent}%)</p>
    <p>${escapeHtml(project.assessments.strategySummary)}</p>
    ${project.assessments.items
      .map(
        it => `<div class="card">
          <h3>${escapeHtml(it.title)} (${escapeHtml(it.type)} · ${it.weightingPercent}%)</h3>
          <p><strong>Instructions:</strong> ${escapeHtml(it.instructions)}</p>
          <p>${escapeHtml(it.promptOrQuestion)}</p>
        </div>`
      )
      .join('\n')}
  `;

  return [
    { name: 'imsmanifest.xml', content: imsManifest },
    { name: 'shared/scorm_api.js', content: SCORM_API_JS },
    { name: 'index.html', content: wrapHtml(title, overviewBody) },
    ...moduleEntries,
    { name: 'assessments.html', content: wrapHtml('Course Assessments', assessmentBody) },
    {
      name: 'course-data.json',
      content: JSON.stringify(
        {
          schema: 'eStudy-SCORM-1.2-Reference-v2',
          exportedAt: new Date().toISOString(),
          title: project.brief.title,
          code: project.brief.code,
          modulesCount: modules.length,
        },
        null,
        2
      ),
    },
  ];
}

export function buildScorm12ZipBytes(project: CourseProject): Uint8Array {
  return buildZipArchive(buildScorm12ZipEntries(project));
}

/**
 * Guide & Skill tools: sdd_get_guide, sdd_get_skill, sdd_list_skills
 *
 * Returns SDD's actual prompt/skill content so Cursor's AI
 * follows the real SDD methodology at each phase.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', 'resources', 'prompts');
const SKILLS_DIR = join(__dirname, '..', 'resources', 'skills');
const TEMPLATES_DIR = join(__dirname, '..', 'resources', 'templates');

// ---------------------------------------------------------------------------
// sdd_get_guide — returns the SDD prompt for a given phase
// ---------------------------------------------------------------------------

const GUIDE_MAP: Record<string, string> = {
  // Discussion phase
  'discuss-milestone': 'guided-discuss-milestone.md',
  'discuss-slice': 'guided-discuss-slice.md',
  'discuss': 'discuss.md',

  // Research phase
  'research-milestone': 'research-milestone.md',
  'research-slice': 'guided-research-slice.md',

  // Planning phase
  'plan-milestone': 'guided-plan-milestone.md',
  'plan-slice': 'guided-plan-slice.md',

  // Execution phase
  'execute-task': 'guided-execute-task.md',
  'resume-task': 'guided-resume-task.md',
  'quick-task': 'quick-task.md',

  // Completion phase
  'complete-slice': 'guided-complete-slice.md',
  'complete-milestone': 'complete-milestone.md',

  // Validation & Reassessment
  'validate-milestone': 'validate-milestone.md',
  'reassess-roadmap': 'reassess-roadmap.md',
  'replan-slice': 'replan-slice.md',

  // UAT
  'run-uat': 'run-uat.md',

  // Special
  'system': 'system.md',
  'triage-captures': 'triage-captures.md',
  'rethink': 'rethink.md',
  'queue': 'queue.md',
  'doctor': 'doctor-heal.md',
  'workflow-start': 'workflow-start.md',
};

export function getGuide(params: { phase: string }): { phase: string; content: string; availablePhases: string[] } {
  const availablePhases = Object.keys(GUIDE_MAP);
  const filename = GUIDE_MAP[params.phase];

  if (!filename) {
    return {
      phase: params.phase,
      content: `Unknown phase '${params.phase}'. Available phases: ${availablePhases.join(', ')}`,
      availablePhases,
    };
  }

  const filepath = join(PROMPTS_DIR, filename);
  if (!existsSync(filepath)) {
    return { phase: params.phase, content: `Prompt file not found: ${filename}`, availablePhases };
  }

  const content = readFileSync(filepath, 'utf-8');
  return { phase: params.phase, content, availablePhases };
}

// ---------------------------------------------------------------------------
// sdd_get_skill — returns skill instructions
// ---------------------------------------------------------------------------

export function getSkill(params: { skill: string }): { skill: string; content: string; availableSkills: string[] } {
  const availableSkills = listAvailableSkills();
  const filepath = join(SKILLS_DIR, `${params.skill}.md`);

  if (!existsSync(filepath)) {
    return {
      skill: params.skill,
      content: `Unknown skill '${params.skill}'. Available: ${availableSkills.map(s => s.id).join(', ')}`,
      availableSkills: availableSkills.map(s => s.id),
    };
  }

  const content = readFileSync(filepath, 'utf-8');
  return { skill: params.skill, content, availableSkills: availableSkills.map(s => s.id) };
}

// ---------------------------------------------------------------------------
// sdd_list_skills — returns all available skills with descriptions
// ---------------------------------------------------------------------------

interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

function listAvailableSkills(): SkillInfo[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
  return files.map(f => {
    const id = f.replace('.md', '');
    const content = readFileSync(join(SKILLS_DIR, f), 'utf-8');
    // Extract name and description from frontmatter
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    return {
      id,
      name: nameMatch ? nameMatch[1].trim() : id,
      description: descMatch ? descMatch[1].trim() : '',
    };
  });
}

export function listSkills(): SkillInfo[] {
  return listAvailableSkills();
}

// ---------------------------------------------------------------------------
// sdd_get_template — returns artifact template for file generation
// ---------------------------------------------------------------------------

export function getTemplate(params: { template: string }): { template: string; content: string; availableTemplates: string[] } {
  const available = listAvailableTemplates();
  const filepath = join(TEMPLATES_DIR, `${params.template}.md`);

  if (!existsSync(filepath)) {
    return {
      template: params.template,
      content: `Unknown template '${params.template}'. Available: ${available.join(', ')}`,
      availableTemplates: available,
    };
  }

  const content = readFileSync(filepath, 'utf-8');
  return { template: params.template, content, availableTemplates: available };
}

function listAvailableTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
}

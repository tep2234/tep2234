export const contact = {
  location: 'Valladolid, Negros Occidental',
  email: 'airahgrants10@gmail.com',
  phone: '09917759298',
  phoneTel: 'tel:09917759298',
  linkedin: 'https://www.linkedin.com/in/ma-airah-jade-grantus',
  messenger: 'https://m.me/maj.grnts',
}

export const hero = {
  eyebrow: 'Organized support for modern digital workflows',
  headline: 'Reliable Virtual Assistant, Administrative Support Specialist, and ESL Educator',
  subheadline:
    'Helping businesses, entrepreneurs, and professionals stay organized through dependable administrative support, customer communication, document management, and virtual assistance.',
}

export const about = {
  paragraphs: [
    'Airah Jade Grantus is a Bachelor of Secondary Education major in English graduate from Carlos Hilado Memorial State University and a TEFL-certified professional with experience in online teaching, communication management, customer support, and administrative assistance.',
    'Her background in ESL teaching helped her develop strong communication, organization, adaptability, and client support skills. She supports businesses and professionals through email management, scheduling, documentation, customer communication, data entry, web research, content creation, and online education support.',
  ],
}

export const services = [
  'Virtual Assistance',
  'Administrative Support',
  'Customer Support',
  'Email Management',
  'Calendar Management',
  'Data Entry',
  'Web Research',
  'Document Preparation',
  'Content Creation',
  'Online ESL Teaching',
  'Lesson Material Development',
] as const

export const skills = [
  { name: 'Communication & Customer Care', level: 95 },
  { name: 'Administrative Organization', level: 92 },
  { name: 'Email & Calendar Management', level: 90 },
  { name: 'Document Preparation & Reporting', level: 88 },
  { name: 'Web Research & Data Entry', level: 90 },
  { name: 'ESL Teaching & Lesson Design', level: 96 },
] as const

export const workflowSteps = [
  {
    title: 'Organize Tasks',
    description:
      'Structuring schedules, to-do lists, and priorities so nothing falls through the cracks.',
    iconName: 'ListChecks',
  },
  {
    title: 'Manage Communication',
    description:
      'Handling emails, messages, and client conversations with clarity, warmth, and professionalism.',
    iconName: 'MessagesSquare',
  },
  {
    title: 'Prepare Documents',
    description:
      'Drafting, formatting, and organizing reports, lesson materials, and administrative files.',
    iconName: 'FileText',
  },
  {
    title: 'Support Clients or Learners',
    description:
      'Providing dependable, friendly support — whether guiding a learner or assisting a business owner.',
    iconName: 'HeartHandshake',
  },
] as const

export const supportAreas = [
  { title: 'Admin Tasks', iconName: 'ClipboardList', description: 'Scheduling, data entry, and day-to-day operational support.' },
  { title: 'Customer Communication', iconName: 'MessageCircle', description: 'Friendly, prompt responses across email and chat.' },
  { title: 'Document Preparation', iconName: 'FileSpreadsheet', description: 'Polished reports, templates, and structured files.' },
  { title: 'Research', iconName: 'Search', description: 'Thorough web research summarized into clear takeaways.' },
  { title: 'ESL Support', iconName: 'GraduationCap', description: 'Lesson planning and learner-focused online teaching.' },
  { title: 'Content Assistance', iconName: 'PenLine', description: 'Drafting and refining everyday written content.' },
] as const

export const experience = [
  {
    role: 'ESL Teacher',
    org: 'Sunside English',
    period: 'Online ESL Instruction',
    description:
      'Delivered engaging online English lessons, prepared learner-focused materials, and supported students with clear, encouraging communication.',
  },
] as const

export const education = [
  {
    school: 'Carlos Hilado Memorial State University',
    program: 'Bachelor of Secondary Education Major in English',
    period: 'Graduated: 2025',
    notes: ["Dean's Lister for Seven Consecutive Semesters"],
  },
  {
    school: 'TEFL Certification',
    program: 'Teaching English as a Foreign Language',
    period: 'Certified',
    notes: ['Qualified for online ESL instruction and lesson material development'],
  },
] as const

export const whyWorkWithMe = [
  {
    title: 'Dependable & Detail-Oriented',
    description: 'Consistent follow-through on tasks, deadlines, and client expectations.',
    iconName: 'ShieldCheck',
  },
  {
    title: 'Strong Communicator',
    description: 'Clear, warm, and professional communication built through years of teaching experience.',
    iconName: 'MessageSquareText',
  },
  {
    title: 'Organized & Adaptable',
    description: 'Comfortable juggling administrative, communication, and education-support tasks at once.',
    iconName: 'LayoutGrid',
  },
  {
    title: 'Education-Backed Expertise',
    description: 'A formal education background paired with TEFL certification and real teaching experience.',
    iconName: 'GraduationCap',
  },
] as const

export type PortfolioCategory = 'Teaching' | 'Admin' | 'Design' | 'Support'
export type PortfolioStatus = 'Coming Soon' | 'Sample Ready'

export interface PortfolioItem {
  title: string
  description: string
  category: PortfolioCategory
  status: PortfolioStatus
  iconName: string
}

export const portfolioItems: PortfolioItem[] = [
  {
    title: 'Lesson Materials',
    description: 'Structured ESL lesson plans and learner activities designed for online classrooms.',
    category: 'Teaching',
    status: 'Sample Ready',
    iconName: 'BookOpenCheck',
  },
  {
    title: 'Canva Designs',
    description: 'Clean, on-brand visuals for social posts, presentations, and learning materials.',
    category: 'Design',
    status: 'Coming Soon',
    iconName: 'Palette',
  },
  {
    title: 'Administrative Templates',
    description: 'Ready-to-use templates for schedules, trackers, and day-to-day office workflows.',
    category: 'Admin',
    status: 'Sample Ready',
    iconName: 'FileSpreadsheet',
  },
  {
    title: 'Social Media Content',
    description: 'Friendly, organized content drafts crafted for consistent online presence.',
    category: 'Design',
    status: 'Coming Soon',
    iconName: 'Megaphone',
  },
  {
    title: 'Customer Support Samples',
    description: 'Sample responses and workflows that show clear, courteous client communication.',
    category: 'Support',
    status: 'Sample Ready',
    iconName: 'Headset',
  },
  {
    title: 'Documents and Reports',
    description: 'Polished reports and structured documents prepared for business and education needs.',
    category: 'Admin',
    status: 'Sample Ready',
    iconName: 'FileText',
  },
]

export const portfolioFilters = ['All', 'Teaching', 'Admin', 'Design', 'Support'] as const

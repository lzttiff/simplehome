# Overview

HomeGuard is a comprehensive home maintenance management application built as a full-stack TypeScript application. The system helps property owners track, manage, and schedule maintenance tasks through an intelligent dashboard interface. It features AI-powered task generation based on property assessments, multiple property templates, and an interactive questionnaire system to create personalized maintenance schedules.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming and responsive design
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management
- **Form Handling**: React Hook Form with Zod schema validation

## Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **API Design**: RESTful API with structured route handlers
- **Data Validation**: Zod schemas for type-safe data validation
- **Development**: Hot module replacement via Vite middleware in development

## Data Storage Solutions
- **Database**: PostgreSQL with Neon Database serverless driver
- **ORM**: Drizzle ORM for type-safe database operations
- **Schema Management**: Drizzle Kit for migrations and schema generation
- **Fallback Storage**: In-memory storage implementation for development/testing

## Authentication and Authorization
- **Session Management**: Express sessions with PostgreSQL session store (connect-pg-simple)
- **Security**: Built-in request logging and error handling middleware

## External Service Integrations
- **AI Services**: OpenAI GPT-4o integration for intelligent task generation and maintenance recommendations
- **Image Assets**: Unsplash integration for property template imagery
- **Development Tools**: None — project does not assume Replit-specific plugins

## Key Design Patterns
- **Shared Schema**: Common TypeScript types and Zod schemas shared between frontend and backend
- **Component Composition**: Modular UI components following atomic design principles
- **Query-based Data Fetching**: Centralized API request handling with caching and error boundaries
- **Type Safety**: End-to-end TypeScript coverage with strict type checking
- **Responsive Design**: Mobile-first approach with adaptive layouts

# External Dependencies

## Core Framework Dependencies
- **@neondatabase/serverless**: Serverless PostgreSQL driver for Neon Database
- **drizzle-orm**: Type-safe ORM for database operations
- **drizzle-kit**: Database schema management and migrations
- **express**: Web application framework for Node.js
- **@tanstack/react-query**: Server state management for React

## UI and Styling
- **@radix-ui/***: Primitive UI components for accessibility and customization
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Utility for creating variant-based component APIs
- **lucide-react**: Icon library for React applications

## Form and Validation
- **react-hook-form**: Performant forms with minimal re-renders
- **@hookform/resolvers**: Validation resolvers for react-hook-form
- **zod**: TypeScript-first schema validation library

## AI and External Services
- **openai**: Official OpenAI API client for GPT integration
- **date-fns**: Date utility library for time-based calculations

## Development and Build Tools
- **vite**: Fast build tool and development server
- **tsx**: TypeScript execution environment for Node.js
 
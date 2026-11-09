// Jeu de données de démonstration (première version : lot B1, Anaïs Lacouture).
// Un senior, un proche (famille), un soignant (médical), reliés par des relations consenties.
// Idempotent : relancé à chaque démarrage du conteneur sans créer de doublons.
// Le senior a l'identifiant "senior-001", celui qu'utilisent les capteurs (registre de Node-RED).

import { ConsentStatus, PrismaClient, Role, Severity } from '@prisma/client';

export const DEMO_SENIOR_ID = 'senior-001';

async function seed(prisma: PrismaClient): Promise<void> {
  const seniorPerson = await prisma.person.upsert({
    where: { email: 'rene@example.com' },
    update: {},
    create: { email: 'rene@example.com', fullName: 'René Dupont', role: Role.SENIOR },
  });
  await prisma.senior.upsert({
    where: { id: DEMO_SENIOR_ID },
    update: {},
    create: { id: DEMO_SENIOR_ID, personId: seniorPerson.id },
  });

  const family = await prisma.person.upsert({
    where: { email: 'marie@example.com' },
    update: {},
    create: { email: 'marie@example.com', fullName: 'Marie Dupont', role: Role.FAMILY },
  });
  const medical = await prisma.person.upsert({
    where: { email: 'dr.martin@example.com' },
    update: {},
    create: { email: 'dr.martin@example.com', fullName: 'Dr Martin', role: Role.MEDICAL },
  });

  for (const caregiver of [family, medical]) {
    await prisma.careRelationship.upsert({
      where: { seniorId_caregiverId: { seniorId: DEMO_SENIOR_ID, caregiverId: caregiver.id } },
      update: {},
      create: {
        seniorId: DEMO_SENIOR_ID,
        caregiverId: caregiver.id,
        relationType: caregiver.role,
        consentStatus: ConsentStatus.GRANTED,
        consentedAt: new Date(),
        createdBy: seniorPerson.id, // le senior a accordé l'accès
      },
    });
  }

  if ((await prisma.toleranceThreshold.count({ where: { seniorId: DEMO_SENIOR_ID } })) === 0) {
    await prisma.toleranceThreshold.create({
      data: { seniorId: DEMO_SENIOR_ID, condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, severity: Severity.WARNING },
    });
  }
  if ((await prisma.emergencyContact.count({ where: { seniorId: DEMO_SENIOR_ID } })) === 0) {
    await prisma.emergencyContact.create({
      data: { seniorId: DEMO_SENIOR_ID, fullName: 'Marie Dupont', phone: '+33600000000', priority: 1 },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log(`Seed terminé : senior ${DEMO_SENIOR_ID}, famille, médical, 2 relations consenties.`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}

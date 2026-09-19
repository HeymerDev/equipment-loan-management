import { prisma } from '../../config/prisma.js';

/** A user as other screens need to show them: never includes credentials. */
export interface UserSummaryDto {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export class UsersService {
  /**
   * Every user, alphabetically. Staff lists are small, so there is no
   * pagination. The history only stores user ids; the web app resolves them to
   * names with this list and offers it as the "user" filter (Req 5.3).
   */
  async listUsers(): Promise<UserSummaryDto[]> {
    return prisma.user.findMany({
      select: { id: true, email: true, fullName: true, role: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  }
}

export const usersService = new UsersService();

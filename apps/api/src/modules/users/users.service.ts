import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ConflictError } from '../../shared/errors.js';
import { generateTemporaryPassword } from '../../shared/password.js';
import type { CreateUserInput } from './users.schema.js';

/** A user as other screens need to show them: never includes credentials. */
export interface UserSummaryDto {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

/** A new account plus the one-time password to hand over. */
export interface CreatedUserDto {
  user: UserSummaryDto;
  temporaryPassword: string;
}

const publicFields = {
  id: true,
  email: true,
  fullName: true,
  role: true,
} satisfies Prisma.UserSelect;

export class UsersService {
  /**
   * Every user, alphabetically. Staff lists are small, so there is no
   * pagination. The history only stores user ids; the web app resolves them to
   * names with this list and offers it as the "user" filter (Req 5.3).
   */
  async listUsers(): Promise<UserSummaryDto[]> {
    return prisma.user.findMany({
      select: publicFields,
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Registers an account with a generated password that the administrator
   * hands over. The password is returned once, never stored in the clear, and
   * the user must replace it before using the system.
   */
  async createUser(input: CreateUserInput): Promise<CreatedUserDto> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    try {
      const user = await prisma.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          role: input.role,
          passwordHash,
          mustChangePassword: true,
        },
        select: publicFields,
      });

      return { user, temporaryPassword };
    } catch (err) {
      // The email is unique in the schema (P2002).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError('Ya existe un usuario con ese email');
      }
      throw err;
    }
  }
}

export const usersService = new UsersService();

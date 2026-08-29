import { Role } from '../enums.js';

/** Public representation of a user. */
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string; // ISO 8601
}

/** Request body for POST /auth/login. */
export interface LoginRequestDto {
  email: string;
  password: string;
}

/** Response body for a successful POST /auth/login or POST /auth/refresh. */
export interface LoginResponseDto {
  accessToken: string;
  user: UserDto;
}

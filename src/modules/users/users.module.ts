import { Module } from '@nestjs/common'; import { UsersController } from './users.controller';
import { AdultUnlockController } from './adult-unlock.controller'; @Module({controllers:[UsersController,AdultUnlockController]}) export class UsersModule{}


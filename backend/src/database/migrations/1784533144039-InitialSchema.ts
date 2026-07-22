import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784533144039 implements MigrationInterface {
  name = 'InitialSchema1784533144039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone_number" character varying(32) NOT NULL, "email" character varying(255) NOT NULL, "password_hash" character varying NOT NULL, "display_name" character varying(64) NOT NULL, "avatar_url" character varying, "is_phone_verified" boolean NOT NULL DEFAULT false, "is_email_verified" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_17d1817f241f10a3dbafb169fd" ON "users"  ("phone_number") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_types" ("id" SMALLSERIAL NOT NULL, "code" character varying NOT NULL, "name" character varying NOT NULL, "min_players" smallint NOT NULL, "max_players" smallint NOT NULL, CONSTRAINT "UQ_815da66847b46f1952270865574" UNIQUE ("code"), CONSTRAINT "PK_5ac179e8c7dc2527ecc0754ccac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "room_players" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "room_id" uuid NOT NULL, "user_id" uuid NOT NULL, "seat_index" smallint NOT NULL, "color" character varying, "status" character varying NOT NULL DEFAULT 'joined', "is_admin" boolean NOT NULL DEFAULT false, "joined_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fa8e2bcf2f068c20f4c3e05ab5f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "rooms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(12), "game_type_id" smallint NOT NULL, "created_by" uuid, "visibility" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'waiting', "max_players" smallint NOT NULL, "rules_json" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0368a2d7c215f2d0458a54933f2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7c77adff21f9b7e9e58c08e63f" ON "rooms"  ("code") WHERE "code" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "matchmaking_tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "game_type_id" smallint NOT NULL, "rules_json" jsonb NOT NULL DEFAULT '{}', "status" character varying NOT NULL DEFAULT 'queued', "matched_room_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_466977a092b1f75bd1ae9dceae9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_moves" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "room_id" uuid NOT NULL, "seat_index" smallint NOT NULL, "move_number" integer NOT NULL, "dice_value" smallint, "move_payload" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ee86699b6166b23c03b5a7cdbc1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "game_states" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "room_id" uuid NOT NULL, "current_turn_seat" smallint NOT NULL, "board_state" jsonb NOT NULL, "turn_number" integer NOT NULL DEFAULT '0', "last_roll" smallint, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f8de23dcb9068fe68a9492c29b4" UNIQUE ("room_id"), CONSTRAINT "REL_f8de23dcb9068fe68a9492c29b" UNIQUE ("room_id"), CONSTRAINT "PK_fba855cac590fa8f05d4f107ad7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_players" ADD CONSTRAINT "FK_969851ff175224dad99e6192c2f" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_players" ADD CONSTRAINT "FK_c152da3ec3120b58336e85f023b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD CONSTRAINT "FK_57ea45a3305b661b9a551391d08" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" ADD CONSTRAINT "FK_4504c6b1b0ed64d82ab24597924" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" ADD CONSTRAINT "FK_dc419e66c54f977a8e77d0268e4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" ADD CONSTRAINT "FK_daf2768bd23449d1a5c0352933b" FOREIGN KEY ("game_type_id") REFERENCES "game_types"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" ADD CONSTRAINT "FK_a1b22ef8ec2687fbf4f7fb4c82d" FOREIGN KEY ("matched_room_id") REFERENCES "rooms"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_moves" ADD CONSTRAINT "FK_da7143b48c2413194973bce1a8b" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_states" ADD CONSTRAINT "FK_f8de23dcb9068fe68a9492c29b4" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "game_states" DROP CONSTRAINT "FK_f8de23dcb9068fe68a9492c29b4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_moves" DROP CONSTRAINT "FK_da7143b48c2413194973bce1a8b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" DROP CONSTRAINT "FK_a1b22ef8ec2687fbf4f7fb4c82d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" DROP CONSTRAINT "FK_daf2768bd23449d1a5c0352933b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "matchmaking_tickets" DROP CONSTRAINT "FK_dc419e66c54f977a8e77d0268e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP CONSTRAINT "FK_4504c6b1b0ed64d82ab24597924"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rooms" DROP CONSTRAINT "FK_57ea45a3305b661b9a551391d08"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_players" DROP CONSTRAINT "FK_c152da3ec3120b58336e85f023b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "room_players" DROP CONSTRAINT "FK_969851ff175224dad99e6192c2f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c"`,
    );
    await queryRunner.query(`DROP TABLE "game_states"`);
    await queryRunner.query(`DROP TABLE "game_moves"`);
    await queryRunner.query(`DROP TABLE "matchmaking_tickets"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7c77adff21f9b7e9e58c08e63f"`,
    );
    await queryRunner.query(`DROP TABLE "rooms"`);
    await queryRunner.query(`DROP TABLE "room_players"`);
    await queryRunner.query(`DROP TABLE "game_types"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_17d1817f241f10a3dbafb169fd"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
